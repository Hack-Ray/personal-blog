# Fork 與部署：建立你自己的部落格

這份文件帶你從 Fork 開始，到在自己的 GitHub Pages 上發布第一篇文章。全程不需要改程式，也不需要原作者的任何帳號或資源。

這是作者自己實際使用的做法：CMS 與資料庫跑在自己的電腦上，公開網站由 GitHub Actions 部署到 GitHub Pages。要把 CMS 放到雲端，或把網站放在其他主機，都可以自行決定；`frontend/` 建置出來的 `out/` 是純靜態檔案，任何靜態主機都能提供。這份文件不涵蓋那些做法。

以下的 `<你的帳號>` 換成你的 GitHub 帳號。每一步都列出要做什麼、做完應該看到什麼、失敗時怎麼查。

## 你會建立的東西

| 東西 | 位置 | 用途 |
|---|---|---|
| 程式 repo（你的 fork） | `<你的帳號>/personal-blog`，公開 | 程式碼與部署 workflow |
| 內容 repo | `<你的帳號>/personal-blog-content`，private | 「更新網站」時匯出的 Snapshot |
| `CONTENT_REPO_TOKEN` | fork 的 Actions secret | 讓部署 workflow 讀取內容 repo |
| 本機 CMS token | 你電腦上的 `backend/.env` | 讓 CMS 啟動部署並查詢結果 |
| 資料庫與 CMS | 你的電腦 | 寫文章、發布 |

## 1. Fork 並開啟 GitHub Pages

1. 在 GitHub Fork 這個 repo。保持公開：免費方案只支援公開 repo 的 Pages。
2. fork → Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。
3. fork → Actions 分頁，若出現「Workflows aren't being run on this forked repository」，按啟用。

預期結果：Actions 分頁看得到 `CI`、`Deploy site`、`Token expiry reminder` 三個 workflow。

網站網址與 basePath 由 Pages 決定：fork 叫 `personal-blog` 時是 `https://<你的帳號>.github.io/personal-blog/`。之後在 Pages 設定自訂網域，下一次部署就會改用該網域。

## 2. 建立內容 repo

1. 在 GitHub 建立 **private** repo `personal-blog-content`。名稱預設是「fork 名稱加 `-content`」；用別的名稱時，第 3 步要設定 `CONTENT_REPO`。
2. 放入一份**空的** Snapshot，第一次部署才有東西可以 build。不要放 `frontend/sample-site-data/`，否則範例文章會出現在你的網站上：

   ```sh
   # 在 personal-blog 以外的位置，例如家目錄
   git clone https://github.com/<你的帳號>/personal-blog.git ~/personal-blog
   git clone https://github.com/<你的帳號>/personal-blog-content.git ~/personal-blog-content
   cp ~/personal-blog/frontend/test-fixtures/empty-site-data/manifest.json ~/personal-blog-content/
   cd ~/personal-blog-content && git add manifest.json && git commit -m "Empty site" && git push
   ```

預期結果：內容 repo 的 `main` 有一個 commit，只含 `manifest.json`。

失敗時：`git clone` 或 `git push` 要求登入或回 403，代表這台電腦的 git 沒有 GitHub 認證。設定 SSH key 或執行 `gh auth login` 後再試。

## 3. 設定 fork 的 Actions secret 與 variables

位置：fork → Settings → Secrets and variables → Actions。

先建立 token：GitHub 頭像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。Repository access 只選內容 repo，Permissions 只給 **Contents: Read-only**。記下到期日。

| 種類 | 名稱 | 內容 | 何時需要 |
|---|---|---|---|
| Secret | `CONTENT_REPO_TOKEN` | 上面的 token | 一定要 |
| Variable | `CONTENT_REPO` | 內容 repo 的 `owner/name` | 內容 repo 不叫 `<fork 名稱>-content` 時 |
| Variable | `GISCUS_REPO_ID`、`GISCUS_CATEGORY_ID` | 從 <https://giscus.app> 取得，見下方 | 要留言功能時 |
| Variable | `GISCUS_REPO`、`GISCUS_CATEGORY` | 預設是這個 fork 與 `Announcements` | 不同時 |
| Variable | `GOOGLE_SITE_VERIFICATION` | Search Console「HTML 標記」驗證方式給的 `<meta name="google-site-verification">` 標籤中 `content` 的值，見下方 | 要在 Google Search Console 登錄網站時 |
| Variable | `PINNED_GITHUB_USER` | GitHub 帳號名稱（login）。文章頁以外的每一頁都會顯示這個帳號的釘選專案，每次部署時更新 | 選用；不設定就不顯示 |

留言（選用）：在 fork 的 Settings → General → Features 勾選 Discussions，安裝 [giscus app](https://github.com/apps/giscus) 並只授權這個 fork。到 <https://giscus.app> 輸入 `<你的帳號>/personal-blog`、分類選 Announcements，頁面產生的 `data-repo-id` 與 `data-category-id` 就是上表的兩個值。沒設定時網站不顯示留言區。

Google Search Console（選用）：到 <https://search.google.com/search-console> 新增資源，選「網址前置字元」並輸入你的 Pages 網址（沒有自訂網域時，github.io 無法使用「網域」資源）。驗證方式選「HTML 標記」，把給你的 `<meta name="google-site-verification" content="...">` 裡 `content` 的值設成上表的 `GOOGLE_SITE_VERIFICATION`，重新部署後按驗證。通過後在「Sitemap」提交 `sitemap.xml`。Pages 網址帶有 `/personal-blog/` 子路徑時，爬蟲不會讀取 `robots.txt`，所以一定要在 Search Console 提交 sitemap。

建議同時開啟 workflow 失敗的 Email 通知：GitHub 頭像 → Settings → Notifications → System → Actions。

預期結果：fork → Actions → `Deploy site` → Run workflow 會成功，你的 Pages 網址顯示一個沒有文章的網站。（這是唯一需要手動啟動部署的時候；之後由 CMS 啟動。）

失敗時：

| 失敗的步驟 | 原因 |
|---|---|
| 第二個 `actions/checkout`（讀內容 repo） | `CONTENT_REPO_TOKEN` 沒設、過期、沒選到內容 repo，或內容 repo 名稱與預設不同卻沒設 `CONTENT_REPO` |
| `actions/configure-pages` | 第 1 步的 Pages Source 沒選 GitHub Actions |
| `deploy` job 被環境保護擋下 | Settings → Environments → `github-pages` 的部署分支規則要允許 `main` |

每週一的 `Token expiry reminder` workflow 會在 token 到期前 30 天或失效時，在 fork 開 issue 提醒。

## 4. 建立本機 CMS 用的 token

Fine-grained token：Repository access 只選你的 fork，Permissions 只給 **Actions: Read and write**（啟動部署、查詢結果）。這個 token 只存在你電腦上的 `backend/.env`，不要 commit。

## 5. 在本機啟動 CMS

依 [`local-setup.md`](./local-setup.md) 第 1 到 7 節安裝工具、建立資料庫、設定管理員密碼並啟動 CMS。第 4 節填 `.env` 時，「更新網站」需要的三項是：

```sh
CONTENT_REPO_DIR=/Users/<你>/personal-blog-content   # 第 2 步的 clone
DEPLOY_REPO=<你的帳號>/personal-blog
CMS_GITHUB_TOKEN=<第 4 步的 token>
```

預期結果：http://127.0.0.1:8000/admin/ 可以登入。`.env` 的設定在第 7 步「更新網站」時才會用到，有錯時會在那裡顯示。

## 6. 換成你的網站資料

在 CMS 的「網站與關於」頁填網站名稱、簡介、頁尾，以及關於頁的名字、連結與經歷。新資料庫的名字預設是 `Your Name`，第一次發布前請換掉。

## 7. 發布第一篇文章並更新網站

1. 在 CMS 建立一篇測試文章（可以附一張圖片），按「發布」。這一步只寫入資料庫，網站不會變。
2. 到「網站發布」按「更新網站」。CMS 會把已發布內容匯出到 `CONTENT_REPO_DIR`、commit、push，再啟動 fork 上的 `Deploy site` workflow。

預期結果：內容 repo 多一個 commit；fork 的 Actions 出現一次 `Deploy content <commit>`；CMS 的發布紀錄最後顯示已上線。

失敗時：

| 發布紀錄顯示 | 原因與處理 |
|---|---|
| 「CONTENT_REPO_DIR must point at a clone」 | `.env` 沒設 `CONTENT_REPO_DIR`，或路徑不是 git clone；改完重啟後端 |
| 「push 失敗」 | 在內容 repo 目錄試 `git push --dry-run`，修好 git 認證後按「重試」 |
| 「無法啟動部署」 | `.env` 沒設 `CMS_GITHUB_TOKEN` 或 `DEPLOY_REPO`，或 token 沒有 fork 的 Actions read/write；修好後重啟後端並按「重試」 |
| 部署失敗 | 打開紀錄裡的 workflow 連結，對照第 3 步的表格 |

## 8. 確認網站

打開你的 Pages 網址，確認：

- 首頁與「文章」列出測試文章，文章頁的圖片正常顯示。
- 「關於」頁與頁尾是第 6 步填的資料。
- `<網址>/sitemap.xml` 與 `<網址>/feed.xml` 裡的連結都是你的網址。
- 有設定 giscus 時，文章底部出現留言區。

## 9. 修改並重新發布

修改測試文章，再按「發布」與「更新網站」。部署成功後重新整理網頁（必要時清快取），確認看到新內容。完成後可以把測試文章刪除，再更新一次網站。

## 之後

- 日常啟動、備份、還原與搬電腦：[`local-setup.md`](./local-setup.md) 第 9 到 12 節。
- 跟上原 repo 的更新：在 fork 頁面按 Sync fork，再在本機 `git pull`，依 `local-setup.md` 第 9 節更新套件並重啟。完整步驟見 [README](../README.md) 的「跟上原 repo 的更新」。
