# 雲端 CMS 的存取控制：Tailscale

CMS 放到雲端主機時，只讓作者自己的裝置連得到。做法是讓主機不對網際網路開任何連接埠，所有連線都走 Tailscale。決策紀錄見 Addendum 03 BE-020。

這份文件只涵蓋存取控制，不指定用哪一種主機。執行 CMS 的設定與排程見 [`local-setup.md`](local-setup.md) 第 13 節。

## 1. 先設定誰可以連到主機

主機加入 tailnet 時要用 `tag:cms`，而 tag 必須先寫在 policy 裡，所以先設定 policy。

在 Tailscale 管理介面的 Access controls 設定 policy，只讓作者的帳號連到 `tag:cms` 的 22 埠（Tailscale SSH）與 443 埠（CMS），並用 Tailscale SSH 登入：

```json
{
  "tagOwners": {
    "tag:cms": ["autogroup:admin"]
  },
  "grants": [
    { "src": ["<作者的 Tailscale 帳號>"], "dst": ["tag:cms"], "ip": ["tcp:22", "tcp:443"] }
  ],
  "ssh": [
    { "action": "check", "src": ["<作者的 Tailscale 帳號>"], "dst": ["tag:cms"], "users": ["<主機上的使用者>"] }
  ]
}
```

Tailscale SSH 同時需要 `grants` 允許 22 埠與 `ssh` 規則，少一個就連不上。tailnet 裡如果還有其他規則（例如預設的「全部允許」），刪掉之前先確認上面的規則已經儲存，否則上面的限制不會生效。

接著在 Settings → Device management 開啟 **Device approval**。新的裝置要經過作者在管理介面核准，才能加入 tailnet。

作者自己的裝置**保留**金鑰到期（預設 180 天），到期時重新登入 Tailscale 即可。

## 2. 主機

1. 在主機上安裝 Tailscale，加入 tailnet 時一併開啟 Tailscale SSH，並加上 `tag:cms`：

   ```sh
   sudo tailscale up --ssh --advertise-tags=tag:cms
   ```

   加了 tag 的裝置，節點金鑰預設不會到期，主機不會因為金鑰到期而突然離線。

2. 確認可以用 Tailscale SSH 登入主機後，**移除主機防火牆（例如 AWS Security Group）的所有進站規則，包括 SSH**。之後管理主機只用 Tailscale SSH，或雲端供應商自己的主控台（例如 AWS Systems Manager Session Manager）。
3. CMS 只綁定 `127.0.0.1:8000`：
   - 用 `backend/scripts/start.sh` 或直接執行 uvicorn 時，預設就是 `127.0.0.1`。
   - 用 repo 根目錄的 `Dockerfile` 時，用 `-p 127.0.0.1:8000:8000` 發布連接埠。

## 3. HTTPS

在 Tailscale 管理介面的 DNS 頁面開啟 MagicDNS 與 HTTPS Certificates，然後在主機上執行：

```sh
sudo tailscale serve --bg 8000
```

`tailscale serve` 會向 Tailscale 取得 `<主機名稱>.<tailnet>.ts.net` 的憑證，以 HTTPS 提供服務，再轉給 `127.0.0.1:8000`。只有 tailnet 裡的裝置連得到這個網址。不要用 `tailscale funnel`，它會把服務公開到網際網路。

## 4. CMS 設定

`backend/.env`（其他欄位見 `backend/.env.example` 的雲端範例）：

```sh
CMS_ENV=cloud
ALLOWED_HOSTS=<主機名稱>.<tailnet>.ts.net
CMS_ORIGIN=https://<主機名稱>.<tailnet>.ts.net
```

CMS 的網址是 `https://<主機名稱>.<tailnet>.ts.net/admin/`。

uvicorn 只信任來自 `FORWARDED_ALLOW_IPS`（預設是本機位址）的 `X-Forwarded-*` 標頭：

- CMS 直接跑在主機上，或容器用 `--network host` 時，`tailscale serve` 的請求來自 `127.0.0.1`，不必設定。
- 容器用 `-p 127.0.0.1:8000:8000` 時，容器看到的來源是 Docker bridge 的閘道位址（通常是 `172.17.0.1`），要設 `FORWARDED_ALLOW_IPS=172.17.0.1`（`docker network inspect bridge` 可查）。

登入錯誤次數依來源位址計算；`tailscale serve` 有沒有把作者裝置的位址放進 `X-Forwarded-For` 還沒有實測過（**推測**）。如果沒有，所有裝置會共用同一個計數，最壞情況是作者自己答錯 5 次後要等待，不會讓其他人有更多次嘗試，因為只有 tailnet 裡的裝置連得到。

## 5. 裝置遺失時

1. 在 Tailscale 管理介面的 Machines 頁面找到那台裝置，選 **Remove**。它立刻無法連到 CMS。
2. 用其他裝置登入 CMS，按「登出所有裝置」，讓遺失裝置上的 session 失效。
3. 如果懷疑密碼也外洩，在主機上重設密碼。重設後，所有已登入的瀏覽器也會被登出。
   - 直接在主機上執行時：`uv run --env-file .env python -m blog.auth`
   - 用容器時：`docker run --rm -it --env-file backend/.env blog-cms python -m blog.auth`

## 6. 第二道驗證

CMS 本身只有一組密碼。要連到登入頁，必須先有一台通過核准、登入作者 Tailscale 帳號的裝置，這是第一道驗證。目前不另外加 TOTP；之後如果 CMS 要開放給 tailnet 以外的網路，再加上。
