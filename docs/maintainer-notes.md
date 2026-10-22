# 作者的部署紀錄

這是作者自己的環境與實際做法，供作者日後查閱。要建立自己的部落格請看 [`fork-and-deploy.md`](./fork-and-deploy.md)，不需要照這裡做。

## 環境

- 程式 repo：`Hack-Ray/personal-blog`（公開），網站 <https://hack-ray.github.io/personal-blog/>。
- 內容 repo：`Hack-Ray/personal-blog-content`（private）。名稱符合預設的 `<repo>-content`，所以不需要設定 `CONTENT_REPO`。
- repo variables：`GISCUS_REPO_ID`、`GISCUS_CATEGORY_ID`（Announcements 分類）。
- 本機 `backend/.env`：`CONTENT_REPO_DIR`、`DEPLOY_REPO=Hack-Ray/personal-blog`、`GITHUB_TOKEN`。

## 2026-10-20：第一次端到端部署

在作者的 Mac（macOS 14）上完成全部設定，並以測試文章走完「CMS 發布 → 更新網站 → GitHub Pages」全流程。

- 安裝：只裝 uv（官方安裝程式 `curl -LsSf https://astral.sh/uv/install.sh | sh`），由 uv 自動下載 Python。這台 Mac 的 Homebrew 沒有 uv、gh、node@22 的 bottle，會從原始碼編譯數十分鐘以上，所以優先用官方安裝程式。Node 22 用 nvm 安裝並設為 default。
- workflow 失敗的 Email 通知已開啟。

## Token

| Token | 用途 | 權限 | 到期 |
|---|---|---|---|
| `CONTENT_REPO_TOKEN`（repo secret） | deploy workflow 讀內容 repo | 內容 repo，Contents: Read-only | 90 天，約 2027-01-18 |
| `personal-blog-cms-deploy`（本機 `.env` 的 `GITHUB_TOKEN`） | CMS 啟動部署、查詢結果 | `personal-blog`，Actions: Read and write | 90 天 |

部署在 checkout 內容 repo 時失敗，先檢查 `CONTENT_REPO_TOKEN`；「更新網站」在觸發部署時失敗，先檢查本機 token。`Token expiry reminder` workflow 與 CMS 的「網站發布」頁都會在到期前提醒。

## 備份

`backend/backups` 是指向 Google Drive「我的雲端硬碟/personal-blog-backups」的 symlink，備份寫入即自動同步。`.gitignore` 的 `backend/backups/` 不會匹配 symlink，所以另在本機 `.git/info/exclude` 加上 `/backend/backups`。

## 雲端 Claude session 與內容 repo（尚未設定）

若要讓雲端 session 以真實內容 build 網站，到 https://github.com/settings/installations → Claude → Configure → Repository access 加上 `personal-blog-content`，開新 session 時選入它。雲端 session 只用來開發與測試，不發文、不 push 內容 repo（規則在 `AGENTS.md`）。GitHub App 無法只給單一 repo 唯讀權限，所以由這條規則約束。
