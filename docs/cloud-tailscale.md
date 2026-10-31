# 雲端 CMS：Tailscale

這是 fork 可以選的雲端做法。CMS 放在一台有 Docker 的 Linux x86-64 主機，主機不對網際網路開任何連接埠，作者的裝置與 GitHub Actions 都經 Tailscale 連線。CMS 仍用自己的密碼登入。決策紀錄見 Addendum 03 BE-020、BE-021。

作者自己的 CMS 改用 EC2 與 Cloudflare，見 [`cloud-ec2.md`](cloud-ec2.md)。兩種做法共用的部分（GitHub environment 與 tag ruleset、部署腳本的步驟、容器限制、CloudWatch Logs、RDS、還原、驗證腳本）見 [`cms-deployment.md`](cms-deployment.md)。這份文件只寫 Tailscale 做法自己的步驟。`cms-production` environment 沒有設 `CMS_DEPLOY_VIA`，或設成 `tailscale` 時，`cms-deploy.yml` 走這份流程。

## 1. 先設定誰可以連到主機

主機加入 tailnet 時要用 `tag:cms`，而 tag 必須先寫在 policy 裡，所以先設定 policy。

在 Tailscale 管理介面的 Access controls 設定 policy。作者的帳號可以連到 `tag:cms` 的 22 埠（Tailscale SSH）與 443 埠（CMS）。CI 用 `tag:cms-ci`，只能連 22 埠：

```json
{
  "tagOwners": {
    "tag:cms": ["autogroup:admin"],
    "tag:cms-ci": ["autogroup:admin"]
  },
  "grants": [
    { "src": ["<作者的 Tailscale 帳號>"], "dst": ["tag:cms"], "ip": ["tcp:22", "tcp:443"] },
    { "src": ["tag:cms-ci"], "dst": ["tag:cms"], "ip": ["tcp:22"] }
  ],
  "ssh": [
    { "action": "check", "src": ["<作者的 Tailscale 帳號>"], "dst": ["tag:cms"], "users": ["<主機上的使用者>"] },
    { "action": "accept", "src": ["tag:cms-ci"], "dst": ["tag:cms"], "users": ["<部署帳號>"] }
  ]
}
```

Tailscale SSH 同時需要 `grants` 允許 22 埠與 `ssh` 規則，少一個就連不上。CI tag 使用 `accept`，不使用需要互動確認的 `check`。tailnet 裡如果還有其他規則（例如預設的「全部允許」），要一併刪掉，否則上面的限制不會生效。

接著在 Settings → Device management 開啟 **Device approval**。新的裝置要經過作者在管理介面核准，才能加入 tailnet。

作者自己的裝置**保留**金鑰到期（預設 180 天），到期時重新登入 Tailscale 即可。

## 2. 準備主機

1. 安裝 Docker Engine、`curl` 與 `flock`，建立部署用的 Linux 使用者，讓它可以執行 Docker。Docker 權限相當於主機管理權限，這個帳號只供部署與維運使用。
2. 安裝 Tailscale，加入 tailnet 時一併開啟 Tailscale SSH，並加上 `tag:cms`：

   ```sh
   sudo tailscale up --ssh --advertise-tags=tag:cms
   ```

   因為已經開啟裝置核准，這個指令會等待核准：到管理介面的 Machines 頁面核准主機後，它才會加入。加了 tag 的裝置，節點金鑰預設不會到期，主機不會因為金鑰到期而突然離線。

3. 確認可以用 Tailscale SSH 登入主機後，**移除主機防火牆（例如 AWS Security Group）的所有進站規則，包括 SSH**。之後管理主機只用 Tailscale SSH，或雲端供應商自己的主控台（例如 AWS Systems Manager Session Manager）。
4. 準備 PostgreSQL 16。資料庫可以使用同一台主機的 Docker，或獨立的 PostgreSQL 服務（RDS 見 `cms-deployment.md` 第 4 節）。使用 `backend/compose.yaml` 時，資料庫只發布在主機的 `127.0.0.1:5432`。部署腳本使用 Docker host network，因此 CMS 也能連到該位址。
5. 建立環境檔案、備份目錄與選用的私鑰目錄。以下路徑只是範例，部署時可以替換。

   ```sh
   sudo mkdir -p /srv/blog/backups /srv/blog/secrets
   sudo chown 1000:1000 /srv/blog/backups /srv/blog/secrets
   sudo chmod 750 /srv/blog/backups /srv/blog/secrets
   ```

6. 依 `backend/.env.example` 建立 `/srv/blog/cms.env`，內容見第 4 節。讓部署帳號可以讀取，並設定 `chmod 600 /srv/blog/cms.env`。
7. 私鑰放在 `/srv/blog/secrets/`，容器內的路徑是 `/run/secrets/`。例如 GitHub App 私鑰：

   ```sh
   sudo install -o 1000 -g 1000 -m 400 <下載的私鑰>.pem /srv/blog/secrets/github-app.pem
   ```

   CMS 容器以 UID 1000 執行，讀不到這個檔案時無法啟動。

環境設定或私鑰不放進 Git，也不放進 Docker image。

主機在 AWS 時，另外確認以下設定。

- Security group 的 inbound 規則保持空白。連線都經過 Tailscale。
- EC2 開啟 IMDSv2 required（`HttpTokens=required`）。CMS 容器使用 host network，可以連到 instance metadata，所以 instance role 只給需要的權限。`infra/aws/cms-ec2.yaml` 的 `HostRole` 是可以照抄的最小權限範例（讀 SSM 參數、只寫入備份 bucket 的一個 prefix、寫入 log group）。
- EBS 或 Lightsail 磁碟使用加密。
- 開啟作業系統自動安全更新，例如 Ubuntu 的 `unattended-upgrades`。
- 想把設定存在 SSM Parameter Store，就把每個設定存成同一個路徑下的 SecureString，例如 `/blog/cms/DATABASE_URL`，路徑下必須有 `CMS_ENV=cloud`。把 `backend/scripts/ssm-env.sh` 複製到主機，用它產生環境檔：

  ```sh
  bash /srv/blog/ssm-env.sh --path /blog/cms --env-file /srv/blog/cms.env --region <region>
  ```

  腳本需要主機上有 AWS CLI 與 `python3`。任何參數名稱不合法、值含有換行，或缺少 `CMS_ENV=cloud` 時，保留原本的檔案。多行的私鑰不放進環境檔，照第 7 步存成檔案。

## 3. HTTPS

在 Tailscale 管理介面的 DNS 頁面開啟 MagicDNS 與 HTTPS Certificates，然後在主機上執行：

```sh
sudo tailscale serve --bg 8000
```

`tailscale serve` 會向 Tailscale 取得 `<主機名稱>.<tailnet>.ts.net` 的憑證，以 HTTPS 提供服務，再轉給 `127.0.0.1:8000`。只有 tailnet 裡的裝置連得到這個網址。不要用 `tailscale funnel`，它會把服務公開到網際網路。

GitHub 的 `CMS_PORT` 改變時，一併把 `tailscale serve` 的目標改成該埠。

## 4. CMS 設定

`/srv/blog/cms.env` 使用 Docker 的 `KEY=value` 格式，不加 shell 引號、不寫 `export`，也不引用其他環境變數。其他欄位見 `backend/.env.example`。

```dotenv
CMS_ENV=cloud
DATABASE_URL=postgresql+psycopg://<user>:<password>@127.0.0.1:5432/<db>
ALLOWED_HOSTS=<主機名稱>.<tailnet>.ts.net
CMS_ORIGIN=https://<主機名稱>.<tailnet>.ts.net
CONTENT_REPO=<你的帳號>/personal-blog-content
DEPLOY_REPO=<你的帳號>/personal-blog
```

容器裡沒有內容 repo 的 clone，所以用 API 發布：設定 `CONTENT_REPO`，不要設定 `CONTENT_REPO_DIR`。認證用 GitHub App 或 personal token，見 [`portable-cms.md`](portable-cms.md)。

CMS 的網址是 `https://<主機名稱>.<tailnet>.ts.net/admin/`。

部署腳本讓 CMS 使用 host network，所以 `tailscale serve` 的請求來自 `127.0.0.1`，不必設定 `FORWARDED_ALLOW_IPS`。登入錯誤次數依來源位址計算；`tailscale serve` 有沒有把作者裝置的位址放進 `X-Forwarded-For` 還沒有實測過（**推測**）。如果沒有，所有裝置會共用同一個計數，最壞情況是作者自己答錯 5 次後要等待，不會讓其他人有更多次嘗試，因為只有 tailnet 裡的裝置連得到。

## 5. 讓 CI 經 Tailscale SSH 部署

建立 Tailscale OAuth client，授予建立裝置所需的權限，並只允許它使用 `tag:cms-ci`。將 client ID 與 secret 分別存成 repo 的 Actions secrets `TS_OAUTH_CLIENT_ID`、`TS_OAUTH_SECRET`。GitHub runner 使用短期節點加入 tailnet，主機不需要開公開 SSH。權限與裝置核准的細節以 [Tailscale GitHub Action 文件](https://tailscale.com/docs/integrations/github/github-action) 為準。

在 `cms-production` environment 設定以下 variables，其他共用的 variables 與 tag ruleset 見 `cms-deployment.md` 第 1 節。

| Variable | 內容 |
| --- | --- |
| `CMS_HOST` | 主機的 Tailscale DNS 名稱，例如 `cms.example.ts.net` |
| `CMS_SSH_USER` | 主機上的部署帳號 |
| `CMS_CI_TAG` | 選用。Tailscale tag，預設 `tag:cms-ci` |

設定完成後推送 `cms-v*` tag 部署，見 `cms-deployment.md` 第 2 節。第一次部署後，用第 7 節還原既有資料，或用第 8 節的命令設定 CMS 的密碼。

## 6. 排程備份與清理

把 `backend/scripts/cloud-maintenance.sh` 複製到主機固定的位置，例如 `/srv/blog/cloud-maintenance.sh`。這個腳本在目前執行中的容器內執行工作，所以使用的程式與設定和 CMS 相同。部署帳號的 crontab 範例：

```cron
PATH=/usr/local/bin:/usr/bin:/bin
0 * * * * bash /srv/blog/cloud-maintenance.sh maintenance blog-cms /srv/blog/backups
30 3 * * * bash /srv/blog/cloud-maintenance.sh backup blog-cms /srv/blog/backups
```

每日備份排在 03:30，不和整點的維護同時開始。兩者與部署共用一個鎖（`cms-deployment.md` 第 3 節），同時開始時較晚的會直接放棄。

備份留在主機仍不能防止主機或磁碟遺失。若使用 S3，在主機安裝 AWS CLI、設定 instance role，再把每日備份改成以下指令。腳本只在備份成功後同步到 S3，同步失敗會回傳非零結束碼。

```cron
30 3 * * * bash /srv/blog/cloud-maintenance.sh backup blog-cms /srv/blog/backups s3://<bucket>/<prefix>/
```

Bucket 開啟加密、版本控制與保存期限。Instance role 只給寫入權限時仍可以用同名檔案覆蓋，所以 bucket 必須開啟版本控制。

## 7. 搬移資料

同一時間只啟動一個 CMS。先停止原本的 CMS（本機是 `backend/scripts/stop.sh`），用 `backend/scripts/backup.sh` 做一份備份，再把 `.dump` 與 `.sha256` 複製到主機的 `/srv/blog/backups/`。第一次部署完成後，在主機執行：

```sh
bash backend/scripts/cloud-restore.sh --dump /srv/blog/backups/<檔名>.dump \
  --env-file /srv/blog/cms.env --backup-dir /srv/blog/backups --secrets-dir /srv/blog/secrets
```

腳本的行為見 `cms-deployment.md` 第 5 節。還原會帶回原本的管理員密碼。

## 8. 密碼與裝置遺失

建立或重設密碼時，在主機執行以下命令。重設後，所有已登入的瀏覽器也會被登出。

```sh
docker exec -it blog-cms python -m blog.auth
```

裝置遺失時：

1. 在 Tailscale 管理介面的 Machines 頁面找到那台裝置，選 **Remove**。它立刻無法連到 CMS。
2. 用其他裝置登入 CMS，按「登出所有裝置」，讓遺失裝置上的 session 失效。
3. 如果懷疑密碼也外洩，用上面的命令重設密碼。

## 9. 第二道驗證

CMS 本身只有一組密碼。要連到登入頁，必須先有一台通過核准、登入作者 Tailscale 帳號的裝置，這是第一道驗證。目前不另外加 TOTP；之後如果 CMS 要開放給 tailnet 以外的網路，再加上，或改用 Cloudflare Access（`cloud-ec2.md`）。
