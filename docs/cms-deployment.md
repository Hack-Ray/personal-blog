# 把 CMS 部署到單台 Linux 主機

這份流程適用於有 Docker 的 Linux x86-64 主機，包括 EC2 或 Lightsail。Workflow 在標準 Ubuntu runner 建置 amd64 image，尚未提供 ARM64 跨架構建置。本機仍使用 `backend/scripts/start.sh`。兩邊使用同一份程式與資料格式，設定寫在各自的環境檔案。

合併到 `main` 只更新公開網站。雲端 CMS 由 `cms-v*` tag 更新，而且必須先開啟 `CMS_DEPLOY_ENABLED`。主機不開公開進站連接埠，GitHub Actions 透過 Tailscale SSH 連線。

## 1. 準備主機

1. 安裝 Docker Engine、`curl` 與 `flock`，讓部署用的 Linux 使用者可以執行 Docker。Docker 權限相當於主機管理權限，這個帳號只供部署與維運使用。
2. 依 [`cloud-access.md`](cloud-access.md) 設定 Tailscale SSH、裝置存取與 HTTPS。
3. 準備 PostgreSQL 16。資料庫可以使用同一台主機的 Docker，或獨立的 PostgreSQL 服務。使用 `backend/compose.yaml` 時，資料庫只發布在主機的 `127.0.0.1:5432`。這份部署流程使用 Docker host network，因此 CMS 也能連到該位址。
4. 建立環境檔案、備份目錄與選用的私鑰目錄。以下路徑只是範例，部署時可以替換。

   ```sh
   mkdir -p /srv/blog/backups /srv/blog/secrets
   sudo chown 1000:1000 /srv/blog/backups /srv/blog/secrets
   chmod 750 /srv/blog/backups /srv/blog/secrets
   ```

5. 依 `backend/.env.example` 建立 `/srv/blog/cms.env`，設定 `CMS_ENV=cloud`、`DATABASE_URL`、`ALLOWED_HOSTS`、`CMS_ORIGIN`，以及發布用的 GitHub 認證。環境檔使用 Docker 的 `KEY=value` 格式，不加 shell 引號、不寫 `export`，也不引用其他環境變數。
6. 讓部署帳號可以讀取 `cms.env`，並設定 `chmod 600 /srv/blog/cms.env`。私鑰放在 `/srv/blog/secrets/` 時，容器內的路徑是 `/run/secrets/`。例如主機的 `github-app.pem` 在容器內是 `/run/secrets/github-app.pem`，檔案必須讓 UID 1000 可讀。

主機在 AWS 時，另外確認以下設定。這些設定不需要改程式。

- Security group 的 inbound 規則保持空白。連線都經過 Tailscale。
- EC2 開啟 IMDSv2 required（`HttpTokens=required`）。CMS 容器使用 host network，可以連到 instance metadata，所以 instance role 只給第 6 節列出的權限。
- EBS 或 Lightsail 磁碟使用加密。
- 開啟作業系統自動安全更新，例如 Ubuntu 的 `unattended-upgrades`。

同一時間只啟動一個 CMS。首次搬遷前，先停用本機 CMS、備份資料庫，再還原到新資料庫，避免兩邊出現不同的草稿與版本。切換流程見 [`local-setup.md`](local-setup.md) 第 12 節。環境設定或私鑰不放進 Git，也不放進 Docker image。

## 2. 允許 CI 透過 Tailscale SSH 部署

在既有的 Tailscale policy 增加一個 CI tag。以下規則要和作者裝置的規則合併。

```json
{
  "tagOwners": {
    "tag:cms": ["autogroup:admin"],
    "tag:cms-ci": ["autogroup:admin"]
  },
  "grants": [
    { "src": ["tag:cms-ci"], "dst": ["tag:cms"], "ip": ["tcp:22"] }
  ],
  "ssh": [
    { "action": "accept", "src": ["tag:cms-ci"], "dst": ["tag:cms"], "users": ["<部署帳號>"] }
  ]
}
```

CI 只需要 SSH，不需要連到 CMS 的 443 埠。CI tag 使用 `accept`，不使用需要互動確認的 `check`。

建立 Tailscale OAuth client，授予建立裝置所需的權限，並只允許它使用 `tag:cms-ci`。將 client ID 與 secret 分別存成 repo 的 Actions secrets `TS_OAUTH_CLIENT_ID`、`TS_OAUTH_SECRET`。GitHub runner 使用短期節點加入 tailnet，主機不需要開公開 SSH。權限與裝置核准的細節以 [Tailscale GitHub Action 文件](https://tailscale.com/docs/integrations/github/github-action) 為準。

## 3. 設定 GitHub 部署環境

在程式 repo 建立名為 `cms-production` 的 GitHub Environment，填入以下 environment variables。`CMS_DEPLOY_ENABLED` 必須放在 repository variables，因為 workflow 在進入 environment 前就判斷是否執行。

| Variable | 內容 |
| --- | --- |
| `CMS_HOST` | 主機的 Tailscale DNS 名稱，例如 `cms.example.ts.net` |
| `CMS_SSH_USER` | 主機上的部署帳號 |
| `CMS_ENV_FILE` | 主機上環境檔案的絕對路徑，例如 `/srv/blog/cms.env` |
| `CMS_BACKUP_DIR` | 主機上的備份目錄，例如 `/srv/blog/backups` |
| `CMS_SECRETS_DIR` | 選用。主機上的私鑰目錄，唯讀掛載成 `/run/secrets` |
| `CMS_CONTAINER` | 選用。容器名稱，預設 `blog-cms` |
| `CMS_PORT` | 選用。主機本機位址的監聽埠，預設 `8000` |
| `CMS_IMAGE` | 選用。GHCR image 路徑，預設 `ghcr.io/<程式 repo 小寫名稱>-cms` |
| `CMS_CI_TAG` | 選用。Tailscale tag，預設 `tag:cms-ci` |
| `CMS_MEMORY` | 選用。CMS 容器的記憶體上限，例如 `768m`。未設定時不限制 |
| `CMS_LOG_GROUP`、`CMS_LOG_REGION` | 選用。兩個一起設定時，CMS 的 log 送到 CloudWatch Logs，見第 6 節 |

主機必須能拉取 `CMS_IMAGE`。Image 只含公開程式與建置好的管理介面，可以把 GHCR package 設為 public。首次推送的 package 可能尚未公開，先在 GitHub package 設定頁調整，再重新執行失敗的 workflow。如果 image 保持 private，在主機部署帳號先完成 `docker login ghcr.io`，並自行管理唯讀 registry 憑證。

在 repository variables 設 `CMS_DEPLOY_ENABLED=true`，才啟用 tag 部署。尚未設值或設為其他值時，推送 tag 不會建置或部署 CMS。

推送 `cms-v*` tag 等於在主機上執行 Docker，所以啟用前先限制誰能推送 tag 與部署。

- 在 repo 的 Settings → Rules → Rulesets 新增 tag ruleset，目標是 `cms-v*`，限制建立、更新與刪除，只讓 repo 管理員略過。
- 在 `cms-production` environment 的 Deployment branches and tags 只允許 `cms-v*` tag。
- 想在每次部署前再確認一次，就在 `cms-production` 勾選 Required reviewers，填自己的帳號。部署會停在核准步驟，核准後才連線到主機。

## 4. 更新 CMS

先在已通過 CI 的程式版本建立 tag，再推送到自己的程式 repo。

```sh
git tag cms-v1.0.0
git push origin cms-v1.0.0
```

`cms-deploy.yml` 再跑一次 CI，接著建置、發布 image，最後透過 Tailscale 執行部署腳本。腳本使用 image digest，避免更新期間讀到不同的 tag 內容。主機依序執行以下步驟。

所有容器都以唯讀檔案系統、移除全部 Linux capabilities、`no-new-privileges` 與最多 256 個 process 執行。`/tmp` 是每個容器自己的 Docker volume，匯出圖片的暫存檔寫在這裡，不佔用記憶體。CMS 容器的 log 預設保留 5 個 10 MB 檔案，避免占滿磁碟。

1. 拉取 image，檢查 CMS 設定。
2. 停止原本的 CMS，讓備份與 migration 期間沒有 CMS 寫入。
3. 將資料庫備份與 `.sha256` 寫入 `CMS_BACKUP_DIR`，並執行 `pg_restore --list` 驗證。
4. 執行 `alembic upgrade head`。
5. 啟動一個新容器，uvicorn 只監聽 `127.0.0.1:CMS_PORT`。
6. 檢查 `/healthz`。失敗時停止新容器。

備份失敗時，腳本會重新啟動原本的 CMS。Migration 開始後若失敗，腳本保留 CMS 停止狀態，避免舊程式寫入部分變更的 schema。這時先查看 workflow 與資料庫錯誤，再決定修正 migration 或還原備份。腳本不會自動還原資料庫。

`CMS_PORT` 改變時，一併把主機的 `tailscale serve` 目標改成該埠。公網進站規則仍維持空白。

只檢查參數與目錄而不部署時，在主機執行。

```sh
bash backend/scripts/deploy-cloud.sh \
  --image ghcr.io/<owner>/<repo>-cms:cms-v1.0.0 \
  --env-file /srv/blog/cms.env \
  --backup-dir /srv/blog/backups \
  --secrets-dir /srv/blog/secrets \
  --dry-run
```

`--dry-run` 不連線到 Docker，也不驗證主機、image 或資料庫是否可用。

## 5. 排程備份與清理

把 `backend/scripts/cloud-maintenance.sh` 複製到主機固定的位置，例如 `/srv/blog/cloud-maintenance.sh`。這個腳本在目前執行中的容器內執行工作，所以使用的程式與設定和 CMS 相同。

部署與排程共用 `CMS_BACKUP_DIR/.cms-deploy.lock`。同時執行時，較晚取得鎖的工作會失敗，排程監控應記錄非零結束碼。

部署帳號的 crontab 範例。

```cron
PATH=/usr/local/bin:/usr/bin:/bin
0 * * * * bash /srv/blog/cloud-maintenance.sh maintenance blog-cms /srv/blog/backups
0 3 * * * bash /srv/blog/cloud-maintenance.sh backup blog-cms /srv/blog/backups
```

備份留在主機仍不能防止主機或磁碟遺失。若使用 S3，在主機安裝 AWS CLI、設定 instance role，再把每日備份的 cron 改成以下指令。腳本只在備份成功後同步到 S3，同步失敗會回傳非零結束碼。

```cron
0 3 * * * bash /srv/blog/cloud-maintenance.sh backup blog-cms /srv/blog/backups s3://<bucket>/<prefix>/
```

Bucket 開啟加密、版本控制與保存期限。S3 位置與排程由主機設定，image 不包含 AWS 憑證。Instance role 的權限見第 6 節。

## 6. 使用 AWS 服務（選用）

以下設定都預設關閉。不使用 AWS 時可以略過。

### 從 SSM Parameter Store 產生環境檔

把每個設定存成 SecureString，名稱放在同一個路徑下，例如 `/blog/cms/DATABASE_URL`、`/blog/cms/CMS_GITHUB_TOKEN`。路徑下必須有 `CMS_ENV`，值是 `cloud`。在主機執行以下命令，產生權限 600 的環境檔。

```sh
bash /srv/blog/ssm-env.sh --path /blog/cms --env-file /srv/blog/cms.env --region <region>
```

腳本複製自 `backend/scripts/ssm-env.sh`，需要主機上有 AWS CLI 與 `python3`。任何參數名稱不合法、值含有換行，或缺少 `CMS_ENV=cloud` 時，保留原本的檔案。執行中的容器不會讀取新值，更新 SSM 後要重新產生環境檔，再部署一次。GitHub App 私鑰有多行，不放進環境檔，改存成 `/srv/blog/secrets/` 下的檔案。

```sh
aws ssm get-parameter --name /blog/cms-github-app-pem --with-decryption \
  --query Parameter.Value --output text > /srv/blog/secrets/github-app.pem
```

### Instance role 的最小權限

主機的 instance role 只需要以下權限。`<bucket>`、`<prefix>`、`<region>`、`<account>` 換成自己的值。使用預設的 `aws/ssm` KMS key 時，可以不列 `kms:Decrypt`。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "ssm:GetParametersByPath",
      "Resource": "arn:aws:ssm:<region>:<account>:parameter/blog/cms" },
    { "Effect": "Allow", "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:<region>:<account>:parameter/blog/cms-github-app-pem" },
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::<bucket>",
      "Condition": { "StringLike": { "s3:prefix": ["<prefix>/*"] } } },
    { "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::<bucket>/<prefix>/*" },
    { "Effect": "Allow", "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:<region>:<account>:log-group:<log group>:*" }
  ]
}
```

`aws s3 sync` 需要 `s3:ListBucket` 比對已上傳的檔案。Role 沒有讀取或刪除備份的權限，但仍可以用同名檔案覆蓋，所以 bucket 必須開啟版本控制。需要更強的保護時，再加 S3 Object Lock。還原時用自己的帳號下載備份，不使用主機的 role。

### 使用 RDS

RDS 需要驗證伺服器憑證。下載 [RDS 的 CA bundle](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) 存成 `/srv/blog/secrets/rds-global-bundle.pem`，讓 UID 1000 可讀，再在 `DATABASE_URL` 加上以下參數。

```dotenv
DATABASE_URL=postgresql+psycopg://<user>:<password>@<endpoint>:5432/<db>?sslmode=verify-full&sslrootcert=/run/secrets/rds-global-bundle.pem
```

CMS、migration 與 `backup.sh` 都使用這個設定。這個做法已用自簽 CA 的 PostgreSQL 實測，正確的 CA 可以連線與備份，錯誤的 CA 會被拒絕。尚未對真正的 RDS 實測。

### 把 log 送到 CloudWatch Logs

先建立 log group，設定保存天數，並給 instance role 上面的 `logs` 權限。再設定 `CMS_LOG_GROUP` 與 `CMS_LOG_REGION`，下次部署後 CMS 容器改用 Docker 的 `awslogs` driver，stream 名稱是容器名稱。主機上的 `docker logs` 仍可使用。

啟用前先在主機確認 Docker 可以寫入 log group。這個步驟失敗時，部署會在 migration 之後停下，CMS 維持停止。

```sh
docker run --rm --log-driver awslogs --log-opt awslogs-group=<log group> \
  --log-opt awslogs-region=<region> --log-opt awslogs-stream=test hello-world
```

## 7. 演練還原

先在獨立的測試資料庫演練。正式還原前停止 CMS，保留目前資料庫的另一份備份。`restore.sh` 會取代目標資料庫全部內容。

```sh
docker stop blog-cms
docker run --rm --network host --env-file /srv/blog/cms.env \
  --mount type=bind,source=/srv/blog/backups,target=/backup \
  --mount type=bind,source=/srv/blog/secrets,target=/run/secrets,readonly \
  ghcr.io/<owner>/<repo>-cms:cms-v1.0.0 \
  scripts/restore.sh /backup/<備份檔名>.dump --env --yes
```

還原使用和備份資料相容的 image，腳本會再執行該 image 的 migration。確認資料內容後，重新執行部署腳本啟動 CMS。不要只換成舊 image 就假設資料庫 schema 也已經回復。

## 8. 驗證部署腳本

在 repo 根目錄執行。

```sh
bash -n backend/scripts/deploy-cloud.sh backend/scripts/cloud-maintenance.sh backend/scripts/ssm-env.sh
python backend/scripts/test-cloud-deploy.py
```

測試以假的 Docker 與 AWS CLI 驗證執行順序、備份失敗恢復、migration 失敗停止、容器限制、參數檢查，以及 SSM 環境檔的產生。2026-10-24 另在 Linux Docker 上實際部署過一次本機 registry 的 image，確認唯讀容器可以 migration、備份、維護、上傳暫存檔並通過健康檢查。這些測試不代表 Tailscale、registry、雲端 PostgreSQL 或正式還原已經實測。完成主機設定後，仍要實際走一次部署與還原演練。
