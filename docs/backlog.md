# 待辦事項

這份清單只記錄還沒處理的問題。完成一項就從清單刪除，在 commit 或 PR 說明寫上項目編號；處理紀錄留在 git 歷史與 PR。已確認的設計決策寫進 `docs/design/` 的 addendum，不留在這裡。新發現的問題加在對應分類的最後。

## 需要先決定的事

- [ ] **運算服務。** 作者目前維持本機執行（Mac 常開時的做法見 `docs/local-setup.md` 第 16 節）。要上雲時再選。
  - 建議先用單台 Lightsail 或 EC2，執行 Tailscale、CMS 與 Postgres，資料庫備份到 S3。每月約 US$5–15（概估，以 AWS 定價為準）。
  - Fargate + RDS + ALB 每月約 US$40 以上，而且要在容器裡跑 Tailscale。
  - 不建議 API Gateway + Lambda：它們的請求大小上限是 10 MB 和 6 MB，而圖片上傳允許到 10 MB。
  - 選定後照 `docs/cms-deployment.md` 設定。容器限制、SSM、最小權限 role、RDS 憑證與 CloudWatch Logs 都已是選用設定。啟用 `cms-v*` tag 部署時，同時建立 tag ruleset（見 `docs/cms-deployment.md`）。
  - CMS 若要開放給 tailnet 以外的網路，還需要第二道驗證（TOTP 或 OIDC）、全域登入次數上限或 WAF，以及正確的 `FORWARDED_ALLOW_IPS`。目前的設計不支援這種用法。
