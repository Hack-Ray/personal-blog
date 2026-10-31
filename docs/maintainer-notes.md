# 作者的部署紀錄

這是作者自己的環境與實際做法，供作者日後查閱。要建立自己的部落格請看 [`fork-and-deploy.md`](./fork-and-deploy.md)，不需要照這裡做。這裡不記 AWS 帳號、主機、bucket 等識別碼，需要時到 AWS 主控台或 stack 的 Outputs 查。

## 環境

- 程式 repo：`Hack-Ray/personal-blog`（公開）。網站使用自訂網域，網域設定在 repo 的 Settings → Pages，DNS 與 CDN 在 Cloudflare（步驟見 [`site-domain.md`](./site-domain.md)）。
- 內容 repo：`Hack-Ray/personal-blog-content`（private）。名稱符合預設的 `<repo>-content`，所以不需要設定 Actions variable `CONTENT_REPO`。
- repo variables：`GISCUS_REPO_ID`、`GISCUS_CATEGORY_ID`（Announcements 分類）、`PINNED_GITHUB_USER=Hack-Ray`、`CMS_DEPLOY_ENABLED=true`，以及讀取內容 repo 用的 `APP_CLIENT_ID`（secret 是 `APP_PRIVATE_KEY`）。沒有設 `GOOGLE_SITE_VERIFICATION`，因為 Search Console 用的是 DNS 驗證的網域資源。
- CMS：在 AWS EC2（東京 region）上，照 [`cloud-ec2.md`](./cloud-ec2.md) 建立。網址是 `cms.<網域>`，經 Cloudflare Tunnel 連線，由 Cloudflare Access 以作者的 GitHub 帳號登入，CMS 沒有密碼。
- 本機：只用來開發與測試。本機 CMS 從 2026-10-31 起停用，不再發布。

## 雲端 CMS

| 項目 | 內容 |
| --- | --- |
| AWS 資源 | 一個以 `infra/aws/cms-ec2.yaml` 建立的 CloudFormation stack。主機、備份 bucket、log group 與部署 role 都在這個 stack |
| 設定 | SSM Parameter Store 的 `/blog/cms/*`（SecureString）。`cms.env` 由 `cloud-host-setup.sh` 從這裡產生 |
| 多行的密碼 | `/blog/cloudflared-token`（tunnel token）、`/blog/cms-github-app-pem`（GitHub App 私鑰）、`/blog/cms-gsc-credentials`（Search Console 服務帳戶金鑰）。主機設定腳本把後兩者寫到 `/srv/blog/secrets/` |
| 發布 | GitHub API，以 GitHub App 認證：`CONTENT_REPO`、`DEPLOY_REPO`、`GITHUB_AUTH=app`、`GITHUB_APP_ID`、`GITHUB_APP_INSTALLATION_ID`、`GITHUB_APP_PRIVATE_KEY_FILE=/run/secrets/github-app.pem`。不用 git clone，也不用 personal token |
| 部署 | `cms-production` environment 設 `CMS_DEPLOY_VIA=ssm`，推送 `cms-v*` tag 時由 `cms-deploy.yml` 經 SSM Run Command 執行 `deploy-cloud.sh` |
| 備份 | 主機 cron 每天 03:30（UTC）把備份寫到 `/srv/blog/backups`，再同步到 S3 bucket 的 `cms/`。另外每次部署前也會備份 |
| 流量數據 | 除了 Cloudflare 與 Search Console，SSM 也設了 `AWS_INSTANCE_ID`、`AWS_REGION`、`BACKUP_BUCKET`，流量數據頁會顯示主機與備份狀態（[`analytics.md`](./analytics.md)） |
| 費用上限 | AWS Budgets 的 `blog-monthly`，每月 US$30。實際花費達到 100% 時，budget action 停止 EC2 主機。主機停止後 CMS 無法使用，公開網站不受影響 |

## 2026-10-20：第一次端到端部署

在作者的 Mac（macOS 14）上完成全部設定，並以測試文章走完「CMS 發布 → 更新網站 → GitHub Pages」全流程。

- 安裝：只裝 uv（官方安裝程式 `curl -LsSf https://astral.sh/uv/install.sh | sh`），由 uv 自動下載 Python。這台 Mac 的 Homebrew 沒有 uv、gh、node@22 的 bottle，會從原始碼編譯數十分鐘以上，所以優先用官方安裝程式。Node 22 用 nvm 安裝並設為 default。
- workflow 失敗的 Email 通知已開啟。

## 2026-10-31：CMS 搬到 EC2

照 [`cloud-ec2.md`](./cloud-ec2.md) 建立 stack、設定主機、推送 `cms-v*` tag 部署，再停止本機 CMS，用 `backup.sh` 做最後一份本機備份，以 `cloud-restore.sh` 還原到主機。之後在雲端 CMS 以 GitHub App 發布成功。

本機 CMS 原本的設定是 `CONTENT_REPO_DIR` 的 git clone 加上 personal token（`CMS_GITHUB_TOKEN`），備份寫到 `backend/backups`，那是指向 Google Drive 資料夾的 symlink。

## GitHub 認證

- 雲端 CMS 與 `deploy.yml` 都用同一個 GitHub App。App 照 [`portable-cms.md`](./portable-cms.md) 建立。CMS 用 App ID 與 installation ID，`deploy.yml` 用 Client ID（`APP_CLIENT_ID`），只取得內容 repo 的 Contents 唯讀 token。
- App 的 token 都是短效的，由後端與 workflow 自動取得，不需要更新。私鑰被撤銷或輪替時，同時更新 SSM 的 `/blog/cms-github-app-pem`（再重新執行 `cloud-host-setup.sh` 並部署）與 repo secret `APP_PRIVATE_KEY`。
- 設定 `APP_CLIENT_ID` 後，`Token expiry reminder` workflow 會自動略過。原本的 `CONTENT_REPO_TOKEN`（repo secret）與本機 CMS 的 personal token 改用 App 後就退役，可以刪除。

部署在 checkout 內容 repo 時失敗，先檢查 App 是否仍裝在內容 repo、`APP_PRIVATE_KEY` 是否正確。「更新網站」在推送或觸發部署時失敗，先看 CMS 發布紀錄的錯誤訊息，再檢查主機上的私鑰檔案。

## 流量數據

照 [`analytics.md`](./analytics.md) 設定，CMS 的「流量數據」頁兩個來源都已接上（2026-10-28）。

- Cloudflare：token 只有 `hackray.dev` 這個 zone 的 Zone → Analytics → Read。
- Google Search Console：網域資源 `sc-domain:hackray.dev`，以 Cloudflare 上的 DNS TXT 記錄驗證，並提交了 `sitemap.xml`。Google Cloud 專案啟用 Search Console API；專用的服務帳戶在 Search Console 有「受限」權限，沒有任何 IAM 角色。
- 服務帳戶的 JSON 金鑰存在 SSM 的 `/blog/cms-gsc-credentials`，主機上是 `/srv/blog/secrets/search-console.json`。CMS 的備份不包含它。要換金鑰時，在 Google Cloud 建一把新的金鑰，更新 SSM 並重新執行 `cloud-host-setup.sh`，再刪掉舊的金鑰。

## 雲端 Claude session 與內容 repo

2026-10-22 已在 https://github.com/settings/installations → Claude → Configure → Repository access 加上 `personal-blog-content`。雲端 session 可以讀取它，以真實內容 build 網站（`SITE_DATA_DIR=<clone 路徑> npm run build`）；只用來開發與測試，不發文、不 push 內容 repo（規則在 `AGENTS.md`）。GitHub App 無法只給單一 repo 唯讀權限，所以由這條規則約束。

## 發布新版本

一般的改動照以下順序上線：

1. PR 通過 CI 後合併到 `main`。改到 `frontend/`、`.nvmrc` 或 `deploy.yml` 時，這次 push 會部署公開網站。
2. 要更新雲端 CMS 時，在 `main` 上推送新的 `cms-v*` tag，例如 `git tag cms-v1.4.0 && git push origin cms-v1.4.0`。不要在 03:30（UTC）前後推送，部署會和每日備份搶同一個鎖。

要讓 fork 知道有新版時，另外建立 release。fork 的 `scripts/start.sh` 以 `backend/pyproject.toml` 的 `version` 和本 repo 最新 release 的 tag 比較，所以兩者要一致。

1. 在 PR 裡把 `backend/pyproject.toml` 的 `version` 改成新版本，執行 `cd backend && uv lock` 更新 `uv.lock`，合併到 `main`。
2. 確認 `main` 的 CI 通過，再建立 release：

   ```sh
   gh release create v0.2.0 --target main --generate-notes
   ```

3. 在 release 說明寫上 fork 需要手動處理的事，例如新的 `.env` 設定、Actions variable 或 secret。

release 的 tag 用 `v<版本>`。不要用 `cms-v` 開頭，`cms-v*` 會觸發 `cms-deploy.yml`。
