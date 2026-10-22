# 在本機與雲端使用同一套 CMS

CMS 使用相同程式與資料表。本機和雲端只透過環境變數切換網址、資料庫、備份與憑證。公開網站仍由內容 Snapshot 建置，不會在 build 時連回 CMS。

## 選擇發布方式

原有 `.env` 只設定 `CONTENT_REPO_DIR` 時，仍使用 git clone。原本的 Git 身分與 push 憑證繼續有效。

改用 API 時，不需要 clone 或 Git 身分。在 `backend/.env` 設定以下項目。

```dotenv
CONTENT_TRANSPORT=api
CONTENT_REPO=your-account/your-blog-content
CONTENT_BRANCH=main
DEPLOY_REPO=your-account/your-blog
DEPLOY_WORKFLOW=deploy.yml
DEPLOY_REF=main
GITHUB_AUTH=token
CMS_GITHUB_TOKEN=replace-with-your-token
```

Token 需要內容 repo 的 Contents 讀寫，以及程式 repo 的 Actions 讀寫。不要把 token 寫入程式、文章或版本控制。API 的憑證和 git clone 的 push 憑證互相獨立；切換 API 後才不再需要後者。

程式 repo 的 Actions variable `CONTENT_BRANCH` 設成相同分支，供程式更新觸發的建置使用。CMS 發布時會將自己的 `CONTENT_BRANCH` 傳給 workflow。

內容 repo 的目標分支必須已存在。新 repo 可先建立 README。既有本機資料庫保留 release 紀錄時，遠端 HEAD 必須和最後一次 release 相同，才能繼續發布。

若還原的資料庫沒有 release 紀錄，但遠端已有 Snapshot，預設拒絕覆蓋。確認這是同一套資料後執行以下命令。

```sh
cd backend
uv run --env-file .env python -m blog.content_repository adopt
```

這個命令逐項比對資料庫匯出內容、版本與圖片。全部一致才記錄遠端 HEAD。它不寫入 GitHub，也不執行部署。不一致時先還原正確的資料庫，不要強制覆蓋遠端。

## 使用 GitHub App

在自己的 GitHub 帳號建立並安裝 GitHub App，只授權給程式 repo 與內容 repo。Repository permissions 設定 Contents 讀寫、Actions 讀寫。停用 Webhook，不需要登入回呼或 CMS 公開網址。

下載 App 私鑰，存到程式 repo 之外。在 `.env` 設定以下項目。

```dotenv
GITHUB_AUTH=app
GITHUB_APP_ID=123456
GITHUB_APP_INSTALLATION_ID=654321
GITHUB_APP_PRIVATE_KEY_FILE=/absolute/path/to/cms-private-key.pem
```

後端在需要時取得 installation token，並在到期前重新取得。本機可使用自己的檔案路徑；容器使用唯讀掛載，例如 `/run/secrets/cms-private-key.pem`。App 私鑰仍須保護並定期輪替。

公開網站 workflow 也可改用同一個 App。設定程式 repo 的 Actions variable `GITHUB_APP_CLIENT_ID`，以及 secret `GITHUB_APP_PRIVATE_KEY`。這裡填的是 App 的 Client ID；後端 `GITHUB_APP_ID` 填數字 App ID。workflow 只取得內容 repo 的 Contents 唯讀 token。App 未設定時繼續用原有 `CONTENT_REPO_TOKEN`。

啟用 App 後，舊的個人 token 到期提醒 workflow 會略過。App 短效 token 自動更新；私鑰若撤銷，發布會明確失敗，仍需管理員更新私鑰。本機 CMS 關機期間不會替私鑰進行主動檢查。

## 發布與重試

CMS 的「更新網站」先建立資料庫中的背景工作，回應 HTTP 202，再由 CMS worker 執行。關閉瀏覽器不會取消已受理工作。重新開啟發布頁會讀回處理狀態。

背景工作開始時讀取當時已發布的內容，不保證擷取按鈕按下那一瞬間的資料。匯出使用單一 REPEATABLE READ Snapshot，圖片逐張寫入暫存目錄，再結束資料庫交易並上傳。

API 先建立 Git blobs、tree 與 commit，但不移動分支。CMS 將 commit、parent、目的地及文章版本記入資料庫，再以非強制方式更新分支。網路中斷後重試時，若遠端已是這個 commit，會接續觸發部署；若其他 CMS 更新遠端，則拒絕覆蓋。

已準備好的工作重啟後使用同一個 commit。尚未準備 Snapshot 的工作會重新讀取當時已發布內容。GitHub workflow dispatch 不提供恰好一次的保證；若回應遺失，重試可能產生另一個部署 run，既有序列化與最新內容檢查會避免舊內容覆蓋新內容。

GitHub 完成提交與 GitHub Pages 完成部署是兩個狀態。背景工作完成後，發布紀錄仍會繼續追蹤 build 與 deploy。舊的同步 API 保留給既有呼叫端，CMS 介面使用新的背景工作 API。

## 切換執行位置

先停用原來的 CMS，再備份並還原到新的位置，保持同一時間只有一套資料庫在寫入。切換網址或執行位置不會同步兩份資料庫。完整切換步驟見 [本機安裝文件](local-setup.md) 第 12 節。

本機繼續使用 `scripts/start.sh`。雲端主機部署與排程見 [CMS 雲端部署](cms-deployment.md)。公開網站的網域與 CDN 見 [網域設定](site-domain.md)。這些程式不會自行建立 AWS、Tailscale、DNS 或 CDN 資源。
