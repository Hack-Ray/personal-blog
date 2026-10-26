# 待辦事項

這份清單只記錄還沒處理的問題。完成一項就從清單刪除，在 commit 或 PR 說明寫上項目編號；處理紀錄留在 git 歷史與 PR。已確認的設計決策寫進 `docs/design/` 的 addendum，不留在這裡。新發現的問題加在對應分類的最後。

2026-10-24 刪除已完成的項目。A 系列、G 系列與 D4–D6 已在 PR #24–#73 完成。剩下的項目都要等作者決定雲端主機或實際啟用 CDN 規則，程式與文件已準備好，啟用時只需設定。

## 需要先決定的事

- [ ] **運算服務。** 作者目前維持本機執行（Mac 常開時的做法見 `docs/local-setup.md` 第 16 節）。要上雲時再選。
  - 建議先用單台 Lightsail 或 EC2，執行 Tailscale、CMS 與 Postgres，資料庫備份到 S3。每月約 US$5–15（概估，以 AWS 定價為準）。
  - Fargate + RDS + ALB 每月約 US$40 以上，而且要在容器裡跑 Tailscale。
  - 不建議 API Gateway + Lambda：它們的請求大小上限是 10 MB 和 6 MB，而圖片上傳允許到 10 MB。
  - 選定後照 `docs/cms-deployment.md` 設定。容器限制、SSM、最小權限 role、RDS 憑證與 CloudWatch Logs 都已是選用設定。
  - CMS 若要開放給 tailnet 以外的網路，還需要第二道驗證（TOTP 或 OIDC）、全域登入次數上限或 WAF，以及正確的 `FORWARDED_ALLOW_IPS`。目前的設計不支援這種用法。

## 自訂網域與 CDN

網域與 CDN 的設定步驟見 `docs/site-domain.md`，以 Cloudflare 為例。D2 已決定：先讓 Pages 以自訂網域取得憑證，再開 Cloudflare proxy，SSL 用 Full (strict)。

- [ ] **D3 部署後清除 CDN 快取。**
  - Cloudflare 預設不快取 HTML 與 JSON，只快取圖片、CSS、JS 等副檔名，並沿用 Pages 的 `Cache-Control: max-age=600`（Browser Cache TTL 要設成 Respect Existing Headers）。所以部署後最多 10 分鐘內可能看到舊圖片；`_next/static/` 檔名帶 hash，不受影響。
  - 目前不需要 purge。之後若開啟 Cache Everything 或延長快取，再在部署 workflow 呼叫 Cloudflare 的 purge API（API token 只給 Zone → Cache Purge 權限）。
- [ ] **D7 在 CDN 套用 CSP。** build 已產生逐頁 CSP，Pages 不會套用。CSP 的 hash 每次部署都會變，Cloudflare 的 Transform Rules 是固定規則，要逐頁套用需要 Worker 或 Snippets 在每次部署後更新。先以 Report-Only 實測，見 `docs/site-domain.md`。
