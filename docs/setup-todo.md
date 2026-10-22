# 待辦：需要在電腦上手動設定的項目

本機安裝與啟動步驟見 [`local-setup.md`](./local-setup.md)。

這些項目需要用你的 GitHub 帳號或本機電腦操作，雲端 session 無法代做。完成一項就把 `[ ]` 改成 `[x]`。

> **2026-10-20**：A、B 區已在作者的 Mac 上完成，並以測試文章走完「CMS 發布 → 更新網站 → GitHub Pages」全流程。實際做法與原文不同之處寫在各項的「實際做法」。

依據：[Addendum 02](./design/personal-blog-system-spec-addendum-02-publishing-pipeline.md)。

## A. 部署網站前必須完成

做完這一區，`main` 上的 deploy workflow 才能成功執行。

- [x] **A1. 確認 `Hack-Ray/personal-blog` 是公開 repo。**
  - GitHub Pages 在免費方案只支援公開 repo。
  - 位置：repo → Settings → General → Danger Zone → Change visibility。
- [x] **A2. 建立 private repo `Hack-Ray/personal-blog-content`。**
  - 用途：存放 Content Snapshot（PUB-002）。
  - 建立後先放一份**空的** Snapshot，第一次部署才有東西可以 build（範例文章 `frontend/sample-site-data/` 不要放，否則會出現在公開網站上）：

    ```sh
    git clone https://github.com/Hack-Ray/personal-blog-content.git ~/personal-blog-content
    cp personal-blog/frontend/test-fixtures/empty-site-data/manifest.json ~/personal-blog-content/
    cd ~/personal-blog-content && git add manifest.json && git commit -m "Empty site" && git push
    ```

  - repo 名稱若不是 `personal-blog-content`，要同時修改 `.github/workflows/deploy.yml` 裡的 `CONTENT_REPO`。
- [x] **A3. 開啟 GitHub Pages。**
  - 位置：`personal-blog` → Settings → Pages → Build and deployment → Source。
  - 選 **GitHub Actions**。
- [x] **A4. 建立讓 Actions 讀取內容 repo 的 token。**
  - 位置：GitHub 頭像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。
  - Repository access：只選 `personal-blog-content`。
  - Permissions：**Contents: Read-only**，其他都不給。
  - 把 token 存到 `personal-blog` → Settings → Secrets and variables → Actions → New repository secret，名稱 **`CONTENT_REPO_TOKEN`**。
  - 記下 token 的到期日；到期前要重新產生並更新 secret。
  - 實際做法：90 天，約 **2027-01-18** 到期。部署在 checkout 內容 repo 時失敗，先檢查這個 token。
- [x] **A5. 開啟 workflow 失敗的 Email 通知。**
  - 位置：GitHub 頭像 → Settings → Notifications → System → Actions。
  - 勾選 Email，並選擇只通知失敗的 workflow（PUB-005）。
- [x] **A6. 把開發分支合併進 `main`。**
  - 合併後 deploy workflow 會自動執行。到 repo 的 Actions 分頁確認成功，再開 `https://hack-ray.github.io/personal-blog/` 檢查。

## B. 開始做本機 CMS／Exporter 時

- [x] **B1. 安裝 Docker**（Docker Desktop 或同等工具），用來在本機跑 PostgreSQL。
- [x] **B2. 安裝 Python 3.12 以上。**
  - 實際做法：只裝 uv（官方安裝程式 `curl -LsSf https://astral.sh/uv/install.sh | sh`），由 uv 自動下載 Python。這台 Mac（macOS 14）的 Homebrew 沒有 uv、gh、node@22 的 bottle，會從原始碼編譯數十分鐘以上，所以優先用官方安裝程式。
- [x] **B3. 確認本機有 Node.js 22。**
  - 實際做法：以 nvm 安裝 Node 22 並設為 default。
- [x] **B4. 建立給本機 CMS 用的 token。**
  - 一樣用 Fine-grained token。
  - Repository access 只選 `personal-blog`，Permissions 只給 **Actions: Read and write**（觸發 deploy workflow、查詢部署結果）。
  - push 到 `personal-blog-content` 用的是你電腦上 git 本身的認證（SSH key 或 `gh auth login`），不是這個 token。
  - 只存在本機的 `backend/.env`，絕對不要 commit（`.gitignore` 已排除 `.env`）。
  - 實際做法：token 名稱 `personal-blog-cms-deploy`，90 天。到期後「更新網站」會在觸發部署時失敗。
  - 在 `backend/.env` 設定 `GITHUB_TOKEN=<token>` 與 `CONTENT_REPO_DIR=<personal-blog-content 的本機 clone 路徑>`（範例見 `backend/.env.example`）。
  - 設定完成後，CMS 的「網站發布 → 更新網站」就能一鍵匯出、push 並啟動部署。
- [x] **B5. 設定 CMS 管理員密碼。**
  - 在 `backend/` 執行 `uv run python -m blog.auth`，輸入兩次密碼（至少 12 個字元）。
  - 之後在 http://127.0.0.1:8000/admin/ 登入。忘記密碼時重新執行同一個指令即可，所有已登入的 session 會被登出。
- [x] **B6. 安排本機 PostgreSQL 的備份**（PUB-006）。
  - 內容 repo 只保存已發布 Snapshot，不能取代資料庫備份。
  - 用 `backend/scripts/start.sh` 啟動 CMS 時會自動備份到 `backend/backups/`（不進 git）。
  - 你要做的：**定期把 `backend/backups/` 複製到雲端硬碟**。還原與搬家步驟見 `docs/local-setup.md` 第 10–13 節。
  - 實際做法：`backend/backups` 改為指向 Google Drive「我的雲端硬碟/personal-blog-backups」的 symlink，備份寫入即自動同步。`.gitignore` 的 `backend/backups/` 不會匹配 symlink，所以另在本機 `.git/info/exclude` 加上 `/backend/backups`。

## C. 讓雲端 Claude session 能操作內容 repo（可選）

- [ ] **C1. 把 Claude GitHub App 的存取權加上 `personal-blog-content`。**
  - 位置：https://github.com/settings/installations → Claude → Configure → Repository access。
  - 之後開新 session 時選入這個 repo，Claude 就能直接讀寫它。
  - 用途：雲端 session 只用來開發與測試，例如以真實內容 build 網站（`SITE_DATA_DIR=<clone 路徑> npm run build`）。**雲端不發文，不 push 內容 repo**（規則寫在 `AGENTS.md`）。GitHub App 無法只給單一 repo 唯讀權限，所以由這條規則約束。
