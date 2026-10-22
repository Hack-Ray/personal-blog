# 待辦事項

這份清單只記錄還沒處理的問題。完成一項就從清單刪除，在 commit 或 PR 說明寫上項目編號；處理紀錄留在 git 歷史與 PR。已確認的設計決策寫進 `docs/design/` 的 addendum，不留在這裡。新發現的問題加在對應分類的最後。

2026-10-21 依 `main` 4c8a432 全面盤點一次。2026-10-22 刪除已完成的項目，見 PR #24–#35、#50–#55。每一項都附上程式位置；標 **推測** 的項目是依程式碼推論，沒有實際執行驗證。

優先順序：

- **必修**：不修就不能上 AWS，或已經會造成資料遺失或錯誤狀態。
- **高**：上線前應該修。
- **中**、**低**：排進之後的工作。

## 需要先決定的事

已決定的事項見 Addendum 03 BE-020（Tailscale）、BE-021（本機與雲端同一份程式碼）與 Addendum 04 FE-013（不允許原始 HTML）。

- [ ] **發布方式。** 二選一：
  - 在容器裡維護內容 repo 的 git clone。
  - 改用 GitHub Git Data API 直接建立 commit，不需要本機 clone，CMS 可以不保存狀態。建議用這個（見 A5）。
- [ ] **GitHub 憑證。** 目前 CMS 用兩個憑證：`CMS_GITHUB_TOKEN` 觸發 workflow，push 內容 repo 則借用作者電腦上的 git 帳號（SSH 金鑰）。建議改成一個 GitHub App，token 會自動輪替（見 A12）。
- [ ] **運算服務。** 候選：ECS Fargate、App Runner、EC2 或 Lightsail。
  - 搭配 Tailscale，建議先用單台 Lightsail 或 EC2 執行 Tailscale、CMS 與 Postgres，資料庫備份到 S3。每月約 US$5–15（概估，以 AWS 定價為準）。
  - Fargate + RDS + ALB 每月約 US$40 以上，而且要在容器裡跑 Tailscale，等熟悉後再考慮。
  - 不建議 API Gateway + Lambda：它們的請求大小上限是 10 MB 和 6 MB，而圖片上傳允許到 10 MB。
  - 決定後才能做 `cms-v*` tag 觸發的 CMS 部署 workflow（BE-021）。

## 一、現在就該修

這些問題和是否上 AWS 無關。

- [ ] **G16（中）部署卡在 GitHub 端時，CMS 沒有任何說明。**（PR #56 處理中）
  - 2026-10-22 GitHub Actions 發生事故，「更新網站」觸發的 run 停在 queued，發布頁只顯示「等待建置」，作者要自己去查 githubstatus.com。
  - 處理：部署等待超過 10 分鐘時，發布頁顯示 GitHub Status 上影響 Actions 或 Pages 的事故（PUB-009）。
- [ ] **G17（低）後端沒有統一的程式碼格式。**
  - 證據：CI 只執行 `ruff check`，沒有 `ruff format --check`。2026-10-22 在 `backend/` 執行 `uv run ruff format --check blog tests`，有 16 個檔案會被重新排版。
  - 處理：一次性執行 `ruff format`，再在 CI 加上 `ruff format --check`。排版的 commit 要和功能修改分開。
- [ ] **G18（低）CMS 建置時有超過 500 kB 的 chunk 警告。**
  - 證據：`npm run build` 回報 Shiki 的語言檔超過 500 kB，最大的是 `cpp-*.js`，約 797 kB（gzip 約 61 kB）。
  - 影響（**推測**）：這些語言檔是開啟編輯器、遇到該語言時才非同步載入，只影響第一次預覽的速度；CMS 在本機或 Tailscale 內使用，影響很小。
  - 處理：評估是否移除少用的語言，或在 `vite.config.ts` 調整 `chunkSizeWarningLimit`，讓真正的新問題不會被這個警告蓋過。
- [ ] **G19（低）程式碼合併到 `main` 時，CI 跑兩次。**
  - 證據：`ci.yml` 自己在 push 到 `main` 時觸發；`deploy.yml` 在 push 時又以 `workflow_call` 呼叫 `ci.yml`。2026-10-22 合併 #55 時，`CI` 與 `Deploy site` 兩個 workflow 各跑了一次完整 CI。
  - 影響：Actions 用量加倍；兩邊結果不一致時（例如偶發失敗）不容易判斷。
  - 處理：`ci.yml` 拿掉 `push` 觸發，只保留 `pull_request` 與 `workflow_call`，讓 `main` 上的 CI 只由 `deploy.yml` 執行。要先確認 branch protection 或其他設定沒有依賴獨立的 `CI` workflow。
- [ ] **G20（低）後端的發布 API 不檢查網址政策。**
  - 證據：`backend/blog/articles.py` 的 `publish` 只檢查標題、Markdown、封面與圖片存在。網址政策只在 CMS 的發布按鈕（`cms/src/publish-checks.ts`）與網站建置（`frontend/src/content/parse.ts`）檢查。
  - 影響：繞過 CMS 直接呼叫 API，可以發布含不允許網址的文章，要到「更新網站」的建置失敗才發現，而且整次部署都會失敗，其他文章的更新也上不去。
  - 處理：後端加上同樣的檢查，並讓後端測試也讀 `frontend/test-fixtures/url-policy.json`，做法比照 `image-refs.json`。

## 二、上 AWS 前必修

除非另外註明，這些項目在本機都不成立或影響很小。

### 必修

- [ ] **A5 發布依賴本機的內容 repo clone。**（#28 已完成鎖、逾時與錯誤訊息；其餘等「發布方式」決定）
  - 證據：
    - `release.py` 的 `content_repo_from_env` 讀取 `CONTENT_REPO_DIR`。
    - `backend/blog/exporter.py` 以 `git commit`、`git push` 發布，git 身分和 push 憑證都沿用作者電腦上的設定（`docs/fork-and-deploy.md` 第 2 步）。
    - 「更新網站」在請求內同步執行。
  - 影響：
    - 新容器沒有 clone，回 503；沒有 git 身分，`git commit` 失敗。
    - push 憑證不在 CMS 的掌握中。2026-10-22 作者電腦的 ssh-agent 沒有載入金鑰，`git fetch` 回 `Permission denied (publickey)`；這時「更新網站」會停在 `push_failed`。目前以 `~/.ssh/config` 的 `AddKeysToAgent`、`UseKeychain` 讓金鑰自動載入。
    - Load Balancer 的閒置逾時（ALB 預設 60 秒）比 push 還短時，作者看到逾時，可能再按一次（**推測**）。
  - 處理：
    - 建議：改用 GitHub Git Data API 建立 commit，以「parent 必須是目前的 HEAD」為條件更新 ref。這樣 CMS 不需要本機 clone，本機與雲端用同一種做法。
    - 改成背景工作，請求立刻回 202。

### 高

- [ ] **A12 三個憑證裡只有兩個有到期提醒。**（`CMS_GITHUB_TOKEN` 改名已完成；其餘等「GitHub 憑證」決定）
  - 證據：
    - `.github/workflows/token-expiry.yml` 每週檢查 `CONTENT_REPO_TOKEN`。
    - CMS 的 `CMS_GITHUB_TOKEN` 只在打開發布頁時檢查。
    - 推送內容 repo 的 SSH 金鑰完全沒有檢查，失效時要到「更新網站」才發現（見 A5）。
  - 處理：
    - 建議改成一個 GitHub App，存進 Secrets Manager。
    - 或改成排程檢查並寄信通知。

## 三、自訂網域與 CDN 的準備

公開網站留在 GitHub Pages，前面加自訂網域與 CDN 時需要處理。

- [ ] **D2 GitHub Pages 前面加 CDN 時的憑證設計。**
  - DNS 指向 CDN 時，Pages 無法自行申請憑證。二選一：
    - 先讓 Pages 用自訂網域取得憑證，再把 CDN 放到前面。
    - CDN 直接以 `hack-ray.github.io/personal-blog` 為來源，並設定 `BASE_PATH=""`。缺點是舊網址會繼續存在，形成重複內容；canonical 可以緩解。
  - 兩種做法都要在 GitHub 驗證網域，防止子網域被搶用（**推測**）。
- [ ] **D3 CDN 快取規則與部署後清除快取。**
  - 有 hash 的檔案可以長期快取：`_next/static/*`、`images/*`、`thumbs/*`。
  - 有 hash 的搜尋內文 `search-data/*` 也可以長期快取。
  - HTML、`feed.xml`、`sitemap.xml`、`search-metadata.json`、`latest-posts.json` 要設短的 TTL，或在部署後清除快取。
  - 目前 release 以 Pages 部署成功判定為 `deployed`，不代表 CDN 已經更新。
- [ ] **D4 沒有 `robots.txt`。** 換成自訂網域後才有意義。處理：加 `frontend/src/app/robots.ts`，指向 sitemap。
- [ ] **D5 RSS 的 GUID 是文章網址。**
  - 證據：`frontend/src/content/feed.ts`。
  - 影響：換網域後，訂閱者的閱讀器會把每篇文章當成新文章再顯示一次。
  - 處理：換網域之前，或和換網域同時，改用以 docId 為基礎、`isPermaLink="false"` 的 GUID。
- [ ] **D6 文章裡寫死的舊網址會變成外部連結。** `frontend/src/content/markdown.ts` 只把開頭是目前 `SITE_ORIGIN` 的連結視為站內連結。處理：換網域前，搜尋內容 repo 裡的舊網址並改成相對路徑。
- [ ] **D7 公開網站的 CSP。** 在 CDN 加安全標頭時，要考慮三件事：內嵌的 `THEME_SCRIPT`（`frontend/src/app/layout.tsx`）需要 hash、giscus 需要 `frame-src https://giscus.app`、Next 本身會輸出內嵌 script。
