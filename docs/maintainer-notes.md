# 作者的部署紀錄

這是作者自己的環境與實際做法，供作者日後查閱。要建立自己的部落格請看 [`fork-and-deploy.md`](./fork-and-deploy.md)，不需要照這裡做。

## 環境

- 程式 repo：`Hack-Ray/personal-blog`（公開）。網站使用自訂網域，網域設定在 repo 的 Settings → Pages，DNS 與 CDN 在 Cloudflare（步驟見 [`site-domain.md`](./site-domain.md)）。
- 內容 repo：`Hack-Ray/personal-blog-content`（private）。名稱符合預設的 `<repo>-content`，所以不需要設定 `CONTENT_REPO`。
- repo variables：`GISCUS_REPO_ID`、`GISCUS_CATEGORY_ID`（Announcements 分類）、`PINNED_GITHUB_USER=Hack-Ray`。沒有設 `GOOGLE_SITE_VERIFICATION`，因為 Search Console 用的是 DNS 驗證的網域資源。
- 本機 `backend/.env`：`CONTENT_REPO_DIR`、`DEPLOY_REPO=Hack-Ray/personal-blog`、`CMS_GITHUB_TOKEN`（舊名 `GITHUB_TOKEN` 仍可用）、`BACKUP_KEEP=30`，以及「流量數據」用的 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ZONE_ID`、`GSC_SITE_URL`、`GSC_CREDENTIALS_FILE`（見下方）。

## 2026-10-20：第一次端到端部署

在作者的 Mac（macOS 14）上完成全部設定，並以測試文章走完「CMS 發布 → 更新網站 → GitHub Pages」全流程。

- 安裝：只裝 uv（官方安裝程式 `curl -LsSf https://astral.sh/uv/install.sh | sh`），由 uv 自動下載 Python。這台 Mac 的 Homebrew 沒有 uv、gh、node@22 的 bottle，會從原始碼編譯數十分鐘以上，所以優先用官方安裝程式。Node 22 用 nvm 安裝並設為 default。
- workflow 失敗的 Email 通知已開啟。

## Token

| Token | 用途 | 權限 | 到期 |
|---|---|---|---|
| `CONTENT_REPO_TOKEN`（repo secret） | deploy workflow 讀內容 repo | 內容 repo，Contents: Read-only | 90 天，約 2027-01-18 |
| `personal-blog-cms-deploy`（本機 `.env` 的 `CMS_GITHUB_TOKEN`） | CMS 啟動部署、查詢結果 | `personal-blog`，Actions: Read and write | 90 天 |

部署在 checkout 內容 repo 時失敗，先檢查 `CONTENT_REPO_TOKEN`；「更新網站」在觸發部署時失敗，先檢查本機 token。`Token expiry reminder` workflow 與 CMS 的「網站發布」頁都會在到期前提醒。

## 備份

`backend/backups` 是指向 Google Drive「我的雲端硬碟/personal-blog-backups」的 symlink，備份寫入即自動同步。`.gitignore` 的 `backend/backups/` 不會匹配 symlink，所以另在本機 `.git/info/exclude` 加上 `/backend/backups`。

## 2026-10-28：流量數據

照 [`analytics.md`](./analytics.md) 設定，CMS 的「流量數據」頁兩個來源都已接上。

- Cloudflare：token 只有 `hackray.dev` 這個 zone 的 Zone → Analytics → Read。
- Google Search Console：網域資源 `sc-domain:hackray.dev`，以 Cloudflare 上的 DNS TXT 記錄驗證，並提交了 `sitemap.xml`。Google Cloud 專案 `blog-analytics-513013` 啟用 Search Console API；服務帳戶 `blog-cms@blog-analytics-513013.iam.gserviceaccount.com` 在 Search Console 有「受限」權限，沒有任何 IAM 角色。
- 服務帳戶的 JSON 金鑰在 `backend/secrets/search-console.json`（git 忽略，權限 600）。CMS 的備份不包含它；換電腦時另外帶過去，或在 Google Cloud 建一把新的金鑰並刪掉舊的。

## 雲端 Claude session 與內容 repo

2026-10-22 已在 https://github.com/settings/installations → Claude → Configure → Repository access 加上 `personal-blog-content`。雲端 session 可以讀取它，以真實內容 build 網站（`SITE_DATA_DIR=<clone 路徑> npm run build`）；只用來開發與測試，不發文、不 push 內容 repo（規則在 `AGENTS.md`）。GitHub App 無法只給單一 repo 唯讀權限，所以由這條規則約束。

## 發布新版本

fork 的 `scripts/start.sh` 以 `backend/pyproject.toml` 的 `version` 和本 repo 最新 release 的 tag 比較，所以兩者要一致。

1. 在 PR 裡把 `backend/pyproject.toml` 的 `version` 改成新版本，執行 `cd backend && uv lock` 更新 `uv.lock`，合併到 `main`。
2. 確認 `main` 的 CI 通過，再建立 release：

   ```sh
   gh release create v0.2.0 --target main --generate-notes
   ```

3. 在 release 說明寫上 fork 需要手動處理的事，例如新的 `.env` 設定、Actions variable 或 secret。

tag 用 `v<版本>`。不要用 `cms-v` 開頭，`cms-v*` 會觸發 `cms-deploy.yml`。
