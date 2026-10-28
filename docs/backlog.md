# 待辦事項

這份清單只記錄還沒處理的問題。完成一項就從清單刪除，在 commit 或 PR 說明寫上項目編號；處理紀錄留在 git 歷史與 PR。已確認的設計決策寫進 `docs/design/` 的 addendum，不留在這裡。新發現的問題加在對應分類的最後。

## 需要先決定的事

- [ ] **雲端 CMS：EC2 + Cloudflare Tunnel。** 作者目前維持本機執行（Mac 常開時的做法見 `docs/local-setup.md` 第 16 節）。上雲時用單台 EC2 執行 CMS 與 Postgres，取代 Tailscale 的存取方式。開始做的時間由作者決定。
  - 存取：主機執行 `cloudflared`，把 `<子網域>.<網域>` 接到 `127.0.0.1:8000`，前面用 Cloudflare Access 只允許作者的帳號。主機不開進站連接埠。需要的網域設定見 `docs/site-domain.md`。
  - 部署與管理：`cms-deploy.yml` 改用 AWS SSM Run Command，GitHub Actions 以 OIDC 取得短期 AWS 權限。作者登入主機用 SSM Session Manager。
  - 選 EC2 而不選 Lightsail，是因為 SSM 與 IAM instance role 在 EC2 上內建，`docs/cms-deployment.md` 的 SSM 環境檔、只寫 S3 備份與 CloudWatch Logs 可以直接用。機型要用 x86（例如 t3.small），因為 image 只建 amd64。每月約 US$15–20（概估，以 AWS 定價為準）。
  - 不能影響 fork 的人：Tailscale 的做法（`docs/cloud-access.md`）保留為預設，新的部署方式由 repository variable 選擇，沒設定時行為不變。文件與程式只用 `<網域>` 這類佔位字，不寫作者自己的網域。
  - 可以考慮讓後端驗證 Cloudflare Access 的 JWT，作為 Tunnel 之外的第二層檢查。
  - 啟用 `cms-v*` tag 部署時，同時建立 tag ruleset（見 `docs/cms-deployment.md`）。
  - CMS 若要不經 Access 直接公開，還需要第二道驗證（TOTP 或 OIDC）、全域登入次數上限或 WAF，以及正確的 `FORWARDED_ALLOW_IPS`。目前的設計不支援這種用法。
