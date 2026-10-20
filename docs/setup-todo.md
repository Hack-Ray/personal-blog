# 待辦：需要在電腦上手動設定的項目

這些項目需要用你的 GitHub 帳號或本機電腦操作，雲端 session 無法代做。完成一項就把 `[ ]` 改成 `[x]`。

依據：[Addendum 02](./personal-blog-system-spec-addendum-02-publishing-pipeline.md)。

## A. 部署網站前必須完成

做完這一區，`main` 上的 deploy workflow 才能成功執行。

- [ ] **A1. 確認 `Hack-Ray/personal-blog` 是公開 repo。**
  - GitHub Pages 在免費方案只支援公開 repo。
  - 位置：repo → Settings → General → Danger Zone → Change visibility。
- [ ] **A2. 建立 private repo `Hack-Ray/personal-blog-content`。**
  - 用途：存放 Content Snapshot（PUB-002）。
  - 可以先放一份範例 Snapshot：把 `frontend/sample-site-data/` 的內容複製到這個 repo 的根目錄並 push。這樣第一次部署就有內容可以 build。
- [ ] **A3. 開啟 GitHub Pages。**
  - 位置：`personal-blog` → Settings → Pages → Build and deployment → Source。
  - 選 **GitHub Actions**。
- [ ] **A4. 建立讓 Actions 讀取內容 repo 的 token。**
  - 位置：GitHub 頭像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。
  - Repository access：只選 `personal-blog-content`。
  - Permissions：**Contents: Read-only**，其他都不給。
  - 把 token 存到 `personal-blog` → Settings → Secrets and variables → Actions → New repository secret，名稱 **`CONTENT_REPO_TOKEN`**。
  - 記下 token 的到期日；到期前要重新產生並更新 secret。
- [ ] **A5. 開啟 workflow 失敗的 Email 通知。**
  - 位置：GitHub 頭像 → Settings → Notifications → System → Actions。
  - 勾選 Email，並選擇只通知失敗的 workflow（PUB-005）。
- [ ] **A6. 把開發分支合併進 `main`。**
  - 合併後 deploy workflow 會自動執行。到 repo 的 Actions 分頁確認成功，再開 `https://hack-ray.github.io/personal-blog/` 檢查。

## B. 開始做本機 CMS／Exporter 時

- [ ] **B1. 安裝 Docker**（Docker Desktop 或同等工具），用來在本機跑 PostgreSQL。
- [ ] **B2. 安裝 Python 3.12 以上。**
- [ ] **B3. 確認本機有 Node.js 22。**
- [ ] **B4. 建立給本機 CMS 用的 token。**
  - 一樣用 Fine-grained token。
  - `personal-blog-content`：**Contents: Read and write**（push Snapshot）。
  - `personal-blog`：**Actions: Read and write**（觸發 deploy workflow、查詢部署結果）。
  - 只存在本機的 `backend/.env`，絕對不要 commit（`.gitignore` 已排除 `.env`）。
  - 在 `backend/.env` 設定 `GITHUB_TOKEN=<token>` 與 `CONTENT_REPO_DIR=<personal-blog-content 的本機 clone 路徑>`（範例見 `backend/.env.example`）。
  - 設定完成後，CMS 的「網站發布 → 更新網站」就能一鍵匯出、push 並啟動部署。
- [ ] **B5. 設定 CMS 管理員密碼。**
  - 在 `backend/` 執行 `uv run python -m blog.auth`，輸入兩次密碼（至少 12 個字元）。
  - 之後在 http://127.0.0.1:8000/admin/ 登入。忘記密碼時重新執行同一個指令即可，所有已登入的 session 會被登出。
- [ ] **B6. 決定本機 PostgreSQL 的備份方式**（PUB-006）。
  - 內容 repo 只保存已發布 Snapshot，不能取代資料庫備份。
  - 要決定的事：備份工具、頻率、存放位置（例如另一顆硬碟或雲端硬碟）。

## C. 讓雲端 Claude session 能操作內容 repo（可選）

- [ ] **C1. 把 Claude GitHub App 的存取權加上 `personal-blog-content`。**
  - 位置：https://github.com/settings/installations → Claude → Configure → Repository access。
  - 之後開新 session 時選入這個 repo，Claude 就能直接讀寫它。
