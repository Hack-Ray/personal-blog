# 雲端 CMS 的登入：Cloudflare Access

CMS 透過 Cloudflare Tunnel 放在 `cms.<網域>` 時，由 Cloudflare Access 負責登入。作者用 GitHub 帳號登入 Access，CMS 本身沒有密碼。決策紀錄見 Addendum 03 BE-026。

這份文件只涵蓋登入。主機與 Cloudflare Tunnel 的設定見 [`cloud-ec2.md`](cloud-ec2.md)。只走 Tailscale、不經過 Cloudflare 的做法見 [`cloud-access.md`](cloud-access.md)，那種做法仍用 CMS 的密碼。

## 運作方式

Cloudflare Access 擋在 `cms.<網域>` 前面。沒有登入的瀏覽器會被導到 Access 的登入頁，登入成功後 Access 給瀏覽器一個 24 小時的 session。

Access 放行的每個請求都帶有 `Cf-Access-Jwt-Assertion` 標頭，內容是 Cloudflare 簽章的 JWT。CMS 每個請求都檢查這個 JWT 的簽章、AUD、issuer、到期時間與 email。檢查不過就回 403，`/admin/` 的頁面與所有 `/api/` 都一樣。只有 `/healthz` 不需要 JWT。

CMS 不發自己的 session，也不存任何登入狀態。設定了 Cloudflare Access 的 CMS 不接受密碼登入。

## 1. 先建立 GitHub 登入方式

1. 在 GitHub 建立一個 OAuth App，步驟依 Cloudflare 文件的 GitHub 登入方式說明。
   - Homepage URL 填 `https://<team>.cloudflareaccess.com`。
   - Authorization callback URL 填 `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`。
2. 在 Cloudflare Zero Trust 的 Settings → Authentication → Login methods 新增 GitHub，填入 OAuth App 的 Client ID 與 Client secret。
3. 用 **Test** 確認可以用作者的 GitHub 帳號登入。

`<team>` 是 Zero Trust 的 team 名稱。完整的 team domain 是 `<team>.cloudflareaccess.com`，在 Zero Trust 的 Settings 頁面可以看到。

## 2. 建立 Access 應用程式

在 Zero Trust 的 Access → Applications 新增一個 **Self-hosted** 應用程式：

- Application domain 填 `cms.<網域>`。
- Session Duration 選 24 hours。
- Login methods 只留 GitHub，關掉 One-time PIN 等其他方式。
- 新增一條 policy，Action 選 **Allow**，Include 選 **Emails**，只填作者的 email。

應用程式建好後，在它的 Overview 分頁複製 **Application Audience (AUD) Tag**。AUD tag 是 64 個十六進位字元。

**先建立 Access 應用程式，再讓 tunnel 的 hostname 上線。** 順序反過來時，`cms.<網域>` 會有一段時間直接連到 CMS。CMS 在那段時間對沒有 JWT 的請求都回 403，但不要依賴這一層。

## 3. CMS 設定

`backend/.env`（其他欄位見 `backend/.env.example`）：

```sh
CMS_ENV=cloud
ALLOWED_HOSTS=cms.<網域>
CMS_ORIGIN=https://cms.<網域>
CLOUDFLARE_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUD=<AUD tag>
CLOUDFLARE_ACCESS_EMAILS=<作者的 email>
```

三個 `CLOUDFLARE_ACCESS_*` 要一起設定。少一個或格式不對時，CMS 不會啟動，錯誤訊息會指出是哪一個。`CLOUDFLARE_ACCESS_EMAILS` 可以用逗號列出多個 email，大小寫不影響比對。這份清單與 Access policy 是兩道檢查，兩邊都要有作者的 email。

設定後不需要執行 `python -m blog.auth`。CMS 不會用到密碼。

## 4. 登出、撤銷與裝置遺失

- **登出**。CMS 的「登出」按鈕會開啟 `https://cms.<網域>/cdn-cgi/access/logout`，結束這個瀏覽器的 Access session。這個模式沒有「登出所有裝置」。
- **Session 中途過期**。CMS 會顯示「登入已過期」，請作者重新載入頁面，再登入一次 Access。
- **撤銷所有 session**。在 Zero Trust 的 My Team → Users 找到作者，選 **Revoke session**。所有裝置都要重新登入 Access。
- **裝置遺失**。先撤銷所有 session，再到 GitHub 登出所有 session 並更換密碼。遺失裝置上的 Access cookie 被撤銷後，Cloudflare 不再放行它。主機只透過 tunnel 對外，沒有其他入口能直接用那個 JWT 連到 CMS。

撤銷由 Cloudflare 執行，CMS 不知道哪些 session 被撤銷。CMS 只檢查 JWT 本身，所以主機不能有繞過 Cloudflare 的入口。

## 5. Cloudflare 的金鑰連不上時

CMS 從 `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` 取得驗證簽章用的公鑰，主機要能對外連 HTTPS。公鑰取得後會留在記憶體裡，只有 CMS 啟動後的第一個請求，以及 Cloudflare 換新金鑰後，才需要再取一次。

取不到公鑰時，CMS 回 503，並在 log 記一行 `cannot fetch Cloudflare Access signing keys`。等網路恢復後重新整理頁面即可，不需要重啟 CMS。`/healthz` 不受影響，所以健康檢查仍會通過。
