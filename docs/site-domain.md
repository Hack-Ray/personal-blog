# 設定公開網站的網域與 CDN

本機 CMS 和雲端 CMS 都把內容 Snapshot 送到內容 repo，再由 Actions 建置公開網站。換網域不需要搬動 CMS，也不需要把 CMS 暴露到網際網路。

## 換成自訂網域

網站預設使用 GitHub Pages 的預設網址。換成自訂網域時，程式和 workflow 不需要修改（Addendum 04 FE-014）。買好網域後，照下面的順序設定。

### 設定 DNS 與 GitHub

1. 先驗證網域，防止別人的 GitHub Pages 搶用你的子網域。到 GitHub 頭像 → Settings → Pages → Add a domain，依畫面在 DNS 加一筆 TXT 紀錄，名稱是 `_github-pages-challenge-<GitHub 帳號>`，等 GitHub 顯示 Verified。
2. 在 DNS 加入指向 GitHub Pages 的紀錄。只用一種做法。
   - 子網域，例如 `blog.example.com`：加一筆 CNAME，值是 `<GitHub 帳號>.github.io`。
   - 根網域，例如 `example.com`：加四筆 A 紀錄 `185.199.108.153`、`185.199.109.153`、`185.199.110.153`、`185.199.111.153`，以及四筆 AAAA 紀錄 `2606:50c0:8000::153`、`2606:50c0:8001::153`、`2606:50c0:8002::153`、`2606:50c0:8003::153`。另外把 `www` 設成 CNAME `<GitHub 帳號>.github.io`。

   這些 IP 位址以 [GitHub 文件](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) 為準。不要用萬用字元紀錄（`*.example.com`）。
3. 到程式 repo 的 Settings → Pages → Custom domain 填入網域，等 DNS 檢查通過，再勾選 **Enforce HTTPS**。憑證可能要幾分鐘到一天才會發出。先讓 Pages 完成網域驗證與 HTTPS 憑證申請，再加入 CDN。
4. 立刻在 CMS 按「更新網站」，或合併一個會觸發部署的變更。網站重新建置之前，已上線的頁面仍使用舊的 basePath，連結和圖片可能失效。

這個設定只改公開網站，不需要動 CMS。換網域之後，GitHub 會把舊的 `github.io` 網址轉到新網域（**推測**，依 GitHub 文件的說明，尚未實測）。

### 建置設定

1. 部署 workflow 會從 `actions/configure-pages` 讀取 `SITE_ORIGIN` 與 `BASE_PATH`。不要把自己的網域寫進程式碼。
2. 如果文章包含舊站的絕對網址，在程式 repo 的 Actions variable 設定 `LEGACY_SITE_URLS`。值是以逗號分隔的舊站根網址，包含舊的 basePath，例如 `https://old.example/blog,https://older.example`。從 GitHub Pages 預設網址換過來時，填 `https://<GitHub 帳號>.github.io/<repo 名稱>`。只列出自己管理的網站。
3. 執行下一次正常部署。Markdown 連結中符合舊站根網址的部分會改為新站的相對網址，路徑、query 與錨點會保留。這個設定不改寫內容 repo 或程式碼範例中的字串，也不替舊網域提供 HTTP redirect。
4. 檢查首頁、文章圖片、站內連結、`feed.xml`、`sitemap.xml` 與 `robots.txt`。
5. 使用 Google Search Console 時，為新網域新增資源，把驗證碼填入 Actions variable `GOOGLE_SITE_VERIFICATION`，再部署一次並提交新的 `sitemap.xml`。

同一個主機上的其他網站不會一起改寫。例如設定 `https://old.example/blog`，不會改寫 `https://old.example/other`。`LEGACY_SITE_URLS` 不允許帳號密碼、query 或 fragment。

本機測試可直接指定以下環境變數。

```sh
cd frontend
BASE_PATH= SITE_ORIGIN=https://new.example LEGACY_SITE_URLS=https://old.example/blog npm run build
BASE_PATH= node scripts/check-links.ts
```

`robots.txt` 的 sitemap 使用這次建置的網址。GitHub Pages 專案網站的檔案位於 `/repo/robots.txt`，無法控制 `https://account.github.io/robots.txt`。自訂網域使用根路徑時，才會位於爬蟲讀取的 `/robots.txt`。

RSS 的 GUID 使用 `urn:ulid:<docId>`，不再隨網域或 basePath 改變。從舊的網址 GUID 切換時，既有閱讀器仍可能將文章重新顯示一次。這是識別方式的一次性遷移，後續換網域不會再改變 GUID。舊 RSS 網址若停止服務，還需要在舊網域設定 redirect，或請訂閱者更換訂閱網址。

## 用 Cloudflare 當 DNS 與 CDN

網域在 Cloudflare 時，照「設定 DNS 與 GitHub」做，再加上以下設定。

1. 前幾步的 DNS 紀錄先全部設成 **DNS only**（灰色雲朵）。Pages 要直接看到自己的 IP，才會通過 DNS 檢查並申請憑證。
2. 等 Pages 顯示憑證已發出、勾好 **Enforce HTTPS**，並用 `https://<網域>/` 開得到網站，再把根網域與 `www` 的 A、AAAA、CNAME 改成 **Proxied**（橘色雲朵）。TXT 驗證紀錄不受影響。
3. SSL/TLS → Overview 設成 **Full (strict)**。不要用 Flexible：Cloudflare 會用 HTTP 連 Pages，而 Pages 會轉回 HTTPS，造成無限重新導向。
4. SSL/TLS → Edge Certificates 開啟 **Always Use HTTPS**。Caching → Configuration 的 **Browser Cache TTL** 設成 **Respect Existing Headers**，沿用 Pages 的 10 分鐘快取。
5. 開啟 proxy 後，Pages 設定頁可能顯示 DNS 檢查未通過，網站仍正常。Pages 續約憑證時的 HTTP 驗證會經過 Cloudflare 轉送，應該能通過（**推測**，未實測）。若出現 Cloudflare 526 錯誤，代表 Pages 憑證失效：把紀錄暫時改回 DNS only，等 Pages 重新發出憑證再改回 Proxied。

Cloudflare 預設只快取圖片、CSS、JS 等靜態副檔名，不快取 HTML 與 JSON，所以部署後不需要清除快取。安全標頭見下一節。

## 安全標頭與 CSP

CSP 分成兩部分（Addendum 04 FE-018）。

- **寫在每個 HTML 裡的 CSP。** `npm run build` 在每個 HTML 的 charset 之後加上 `<meta http-equiv="Content-Security-Policy">`。script 只允許自己網站的檔案、`https://giscus.app`，以及該頁 inline script 的 SHA-256 hash，不允許 `unsafe-inline` 或 `unsafe-eval`。hash 依該次 build 的 HTML 產生，所以每次部署都自動正確，GitHub Pages 不需要設定標頭，CDN 也不需要逐頁規則。程式碼高亮與元件需要 inline style，所以 `style-src` 保留 `unsafe-inline`；giscus 會在頁面載入自己的樣式表，所以 `style-src` 也允許 `https://giscus.app`。圖片允許任何 `https:` 來源。
- **只能放在回應標頭的部分。** `frame-ancestors`（禁止別的網站用 iframe 嵌入）在 meta 裡無效，要由 CDN 加上。下面三個標頭每個回應都一樣，`out/cdn-headers.json` 的 `entries` 也列了同樣的值。

| 標頭 | 值 |
| --- | --- |
| `Content-Security-Policy` | `frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

瀏覽器同時套用 meta 與標頭裡的 CSP，兩者都要允許才會載入。

### 在 Cloudflare 加上標頭

免費方案就能做，不需要 Worker。

1. 進入網域 → **Rules** → **Overview** → **Create rule** → **Response Header Transform Rule**。
2. 名稱填 `Security headers`，套用範圍選 **All incoming requests**。
3. 在 **Modify response header** 加三列，動作都選 **Set static**，名稱與值照上表填。值的單引號要一起貼上。
4. 按 **Deploy**。

想先觀察再啟用時，第一列的名稱可以先用 `Content-Security-Policy-Report-Only`，確認沒有問題再改成 `Content-Security-Policy`。

### 會被 CSP 擋下的 CDN 功能

CDN 往 HTML 插入的 script 若不是來自同一個網域，或是沒有列在 hash 裡的 inline script，會被 CSP 擋下。Cloudflare 的 **Rocket Loader** 會改寫 script，必須關閉（預設關閉）。**Web Analytics** 的自動注入會被擋，本專案的流量數據改從 Cloudflare API 讀取（Addendum 03 BE-024），不需要開啟它。**Email Address Obfuscation** 的 script 在同一個網域下，不受影響。

### 確認是否生效

1. 用 `curl -sI https://<網域>/` 確認回應有上表三個標頭。
2. 用電腦瀏覽器開首頁與一篇有留言區的文章，打開開發者工具的 Console，不應該出現 `Content Security Policy` 開頭的錯誤。
3. 確認主題切換、站內搜尋、程式碼複製、圖片放大、分享按鈕與 giscus 留言都正常。

之後若加入新的外部 script、iframe 或 API，要在 `frontend/src/content/cdn-headers.ts` 調整來源清單，CI 的 e2e 測試會在 CSP 擋住網站功能時失敗。

### 快取標頭

`out/cdn-headers.json` 也列出每個檔案建議的 `Cache-Control`，供可以逐路徑設定標頭的 CDN 使用。目前 Cloudflare 沿用 Pages 的快取時間（見上一節），不需要套用這份檔案。`_next/static/` 以及檔名是 64 位 SHA-256 的 `images/`、`thumbs/` 可以快取一年，其餘檔案每次重新驗證，CDN 最多快取 60 秒。若之後延長 HTML 的快取，部署後要清除 HTML、RSS、sitemap、robots 與搜尋資料的快取。不要把 CDN API token 寫入文章或 `cdn-headers.json`。
