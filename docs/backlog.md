# 待辦事項

這份清單只記錄還沒處理的問題。完成一項就從清單刪除，在 commit 或 PR 說明寫上項目編號；處理紀錄留在 git 歷史與 PR。已確認的設計決策寫進 `docs/design/` 的 addendum，不留在這裡。新發現的問題加在對應分類的最後。

## 需要先決定的事

- [ ] **運算服務。** 作者目前維持本機執行（Mac 常開時的做法見 `docs/local-setup.md` 第 16 節）。要上雲時再選。
  - 建議先用單台 Lightsail 或 EC2，執行 Tailscale、CMS 與 Postgres，資料庫備份到 S3。每月約 US$5–15（概估，以 AWS 定價為準）。
  - Fargate + RDS + ALB 每月約 US$40 以上，而且要在容器裡跑 Tailscale。
  - 不建議 API Gateway + Lambda：它們的請求大小上限是 10 MB 和 6 MB，而圖片上傳允許到 10 MB。
  - 選定後照 `docs/cms-deployment.md` 設定。容器限制、SSM、最小權限 role、RDS 憑證與 CloudWatch Logs 都已是選用設定。啟用 `cms-v*` tag 部署時，同時建立 tag ruleset（見 `docs/cms-deployment.md`）。
  - CMS 若要開放給 tailnet 以外的網路，還需要第二道驗證（TOTP 或 OIDC）、全域登入次數上限或 WAF，以及正確的 `FORWARDED_ALLOW_IPS`。目前的設計不支援這種用法。

## CDN

網域與 CDN 的設定步驟見 `docs/site-domain.md`，決策見 Addendum 04 FE-014。CDN 不快取 HTML 與 JSON，部署後不需要清除快取，圖片最多 10 分鐘內可能是舊的；之後若開啟 Cache Everything 或延長快取，再在部署 workflow 呼叫 CDN 的 purge API。

- [ ] **D7 在 CDN 套用 CSP。** build 已產生逐頁 CSP（`cdn-headers.json`），Pages 不會套用。CSP 的 hash 每次部署都會變，Cloudflare 的 Transform Rules 是固定規則，要逐頁套用需要 Worker 或 Snippets 在每次部署後更新。先以 Report-Only 實測，見 `docs/site-domain.md`。

## 文章網址

- [ ] **S1 設定 slug 與更新網站同時進行時，兩篇文章可能宣告同一個網址。** 「更新網站」匯出時文章 A 的 slug 是 X；匯出完成、寫入 `article_urls` 之前，A 改掉 X、B 設成 X，`set_slug` 的占用檢查還看不到 (A, X)，所以通過。之後 `record_export` 寫入 (A, X)，下一次匯出的 manifest 就讓 A 的 `redirect_from` 與 B 的 slug 都是 X。前端 parser 讓 build 失敗，不會部署錯的網站，但作者要改掉 slug 再更新一次。修法之一是讓 `set_slug` 與 `record_export` 取得同一把鎖；發布用的是 `pg_try_advisory_lock`，直接共用會讓更新網站期間的 slug 儲存被拒絕而不是等待（Addendum 03 BE-023）。
