# 待辦事項

這份清單只記錄還沒處理的問題。完成一項就從清單刪除，在 commit 或 PR 說明寫上項目編號；處理紀錄留在 git 歷史與 PR。已確認的設計決策寫進 `docs/design/` 的 addendum，不留在這裡。新發現的問題加在對應分類的最後。

2026-10-24 刪除已完成的項目。A 系列、G 系列與 D4–D6 已在 PR #24–#73 完成。剩下的項目都要等作者決定雲端主機或網域，程式與文件已準備好，啟用時只需設定。

## 需要先決定的事

- [ ] **運算服務。** 作者目前維持本機執行（Mac 常開時的做法見 `docs/local-setup.md` 第 16 節）。要上雲時再選。
  - 建議先用單台 Lightsail 或 EC2，執行 Tailscale、CMS 與 Postgres，資料庫備份到 S3。每月約 US$5–15（概估，以 AWS 定價為準）。
  - Fargate + RDS + ALB 每月約 US$40 以上，而且要在容器裡跑 Tailscale。
  - 不建議 API Gateway + Lambda：它們的請求大小上限是 10 MB 和 6 MB，而圖片上傳允許到 10 MB。
  - 選定後照 `docs/cms-deployment.md` 設定。容器限制、SSM、最小權限 role、RDS 憑證與 CloudWatch Logs 都已是選用設定。
  - CMS 若要開放給 tailnet 以外的網路，還需要第二道驗證（TOTP 或 OIDC）、全域登入次數上限或 WAF，以及正確的 `FORWARDED_ALLOW_IPS`。目前的設計不支援這種用法。

## 自訂網域與 CDN

作者目前不設網域。買網域後的 DNS 與 GitHub 設定見 `docs/site-domain.md`。以下項目要等選定 CDN 才能處理。

- [ ] **D2 GitHub Pages 前面加 CDN 時的憑證設計。**
  - DNS 指向 CDN 時，Pages 無法自行申請憑證。二選一：
    - 先讓 Pages 用自訂網域取得憑證，再把 CDN 放到前面。
    - CDN 直接以 `hack-ray.github.io/personal-blog` 為來源，並設定 `BASE_PATH=""`。缺點是舊網址會繼續存在，形成重複內容；canonical 可以緩解。
  - 兩種做法都要在 GitHub 驗證網域，防止子網域被搶用（**推測**）。
- [ ] **D3 部署後清除 CDN 快取。**
  - 快取規則已由 build 產生在 `out/cdn-headers.json`。
  - 目前 release 以 Pages 部署成功判定為 `deployed`，不代表 CDN 已經更新。選定 CDN 後，在部署 workflow 呼叫它的 purge API。
- [ ] **D7 在 CDN 套用 CSP。** build 已產生逐頁 CSP，Pages 不會套用。要在 CDN 先以 Report-Only 實測，見 `docs/site-domain.md`。
