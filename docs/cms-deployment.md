# 雲端 CMS：兩種做法共用的部署參考

CMS 可以放到一台有 Docker 的 Linux x86-64 主機。有兩種做法，主機上執行同一個部署腳本 `backend/scripts/deploy-cloud.sh`，由 `cms-production` environment 的 `CMS_DEPLOY_VIA` 選擇 GitHub Actions 怎麼連到主機。

| 做法 | `CMS_DEPLOY_VIA` | 登入 | 文件 |
| --- | --- | --- | --- |
| AWS EC2，經 Cloudflare Tunnel 與 Access 連線，SSM Run Command 部署。作者使用這種做法 | `ssm` | Cloudflare Access（GitHub 帳號） | [`cloud-ec2.md`](cloud-ec2.md) |
| 任何 Linux 主機，經 Tailscale 連線與部署 | 不設定或 `tailscale` | CMS 的密碼 | [`cloud-tailscale.md`](cloud-tailscale.md) |

這份文件寫兩種做法共用的部分。主機的準備、連線與排程寫在各自的文件。Workflow 在標準 Ubuntu runner 建置 amd64 image，尚未提供 ARM64 跨架構建置。本機的 CMS 仍使用 `backend/scripts/start.sh`（[`local-setup.md`](local-setup.md)）。兩邊使用同一份程式與資料格式，設定寫在各自的環境檔案。

## 雲端的 CMS 設定

雲端的 CMS 設 `CMS_ENV=cloud`，並且必須設定 `DATABASE_URL`、`ALLOWED_HOSTS`、`CMS_ORIGIN`（範例在 `backend/.env.example`）。這時 cookie 自動加上 Secure、回應加上 HSTS，`/docs` 關閉，CMS 執行期間的每日備份也關閉，改由主機排程。CMS 必須放在網域的根目錄（例如 `https://cms.<網域>/admin/`），不能放在子路徑下。監控可以用 `GET /healthz`，它不檢查 Host，會查詢一次資料庫。

容器裡沒有內容 repo 的 clone，所以雲端的 CMS 用 API 發布：設定 `CONTENT_REPO`，不設定 `CONTENT_REPO_DIR`。認證用 GitHub App 或 personal token，見 [`portable-cms.md`](portable-cms.md)。

部署腳本把主機的私鑰目錄唯讀掛載成容器內的 `/run/secrets/`。例如主機的 `github-app.pem` 在容器內是 `/run/secrets/github-app.pem`。CMS 容器以 UID 1000 執行，檔案必須讓 UID 1000 可讀。

同一時間只啟動一個 CMS。首次搬遷前，先停用原本的 CMS、備份資料庫，再還原到新資料庫，避免兩邊出現不同的草稿與版本（[`local-setup.md`](local-setup.md) 第 12 節）。

## 1. 設定 GitHub 部署環境

在程式 repo 建立名為 `cms-production` 的 GitHub Environment，填入以下 environment variables。各做法自己的 variables 見它的文件。`CMS_DEPLOY_ENABLED` 必須放在 repository variables，因為 workflow 在進入 environment 前就判斷是否執行。

| Variable | 內容 |
| --- | --- |
| `CMS_DEPLOY_VIA` | 選用。`tailscale`（預設）或 `ssm`。其他值會讓部署失敗 |
| `CMS_HOST`、`CMS_SSH_USER`、`CMS_CI_TAG` | `tailscale` 用，見 `cloud-tailscale.md` 第 5 節 |
| `CMS_AWS_ROLE_ARN`、`CMS_AWS_REGION`、`CMS_INSTANCE_ID` | `ssm` 用，見 `cloud-ec2.md` 第 6 節 |
| `CMS_ENV_FILE` | 主機上環境檔案的絕對路徑，例如 `/srv/blog/cms.env` |
| `CMS_BACKUP_DIR` | 主機上的備份目錄，例如 `/srv/blog/backups` |
| `CMS_SECRETS_DIR` | 選用。主機上的私鑰目錄，唯讀掛載成 `/run/secrets` |
| `CMS_CONTAINER` | 選用。容器名稱，預設 `blog-cms` |
| `CMS_PORT` | 選用。主機本機位址的監聽埠，預設 `8000` |
| `CMS_IMAGE` | 選用。GHCR image 路徑，預設 `ghcr.io/<程式 repo 小寫名稱>-cms` |
| `CMS_MEMORY` | 選用。CMS 容器的記憶體上限，例如 `768m`。未設定時不限制 |
| `CMS_LOG_GROUP`、`CMS_LOG_REGION` | 選用。兩個一起設定時，CMS 的 log 送到 CloudWatch Logs，見第 4 節 |

主機必須能拉取 `CMS_IMAGE`。Image 只含公開程式與建置好的管理介面，可以把 GHCR package 設為 public。首次推送的 package 可能尚未公開，先在 GitHub package 設定頁調整，再重新執行失敗的 workflow。如果 image 保持 private，在主機部署帳號先完成 `docker login ghcr.io`，並自行管理唯讀 registry 憑證。

在 repository variables 設 `CMS_DEPLOY_ENABLED=true`，才啟用 tag 部署。尚未設值或設為其他值時，推送 tag 不會建置或部署 CMS。

推送 `cms-v*` tag 等於在主機上執行 Docker，所以啟用前先限制誰能推送 tag 與部署。

- 在 repo 的 Settings → Rules → Rulesets 新增 tag ruleset，目標是 `cms-v*`，限制建立、更新與刪除，只讓 repo 管理員略過。
- 在 `cms-production` environment 的 Deployment branches and tags 只允許 `cms-v*` tag。
- 想在每次部署前再確認一次，就在 `cms-production` 勾選 Required reviewers，填自己的帳號。部署會停在核准步驟，核准後才連線到主機。

## 2. 更新 CMS

合併到 `main` 只更新公開網站。雲端 CMS 由 `cms-v*` tag 更新。先在已通過 CI 的程式版本建立 tag，再推送到自己的程式 repo。

```sh
git tag cms-v1.0.0
git push origin cms-v1.0.0
```

`cms-deploy.yml` 再跑一次 CI，接著建置、發布 image，最後經 Tailscale SSH 或 SSM 在主機執行部署腳本。腳本使用 image digest，避免更新期間讀到不同的 tag 內容。主機依序執行以下步驟。

1. 拉取 image，檢查 CMS 設定。
2. 停止原本的 CMS，讓備份與 migration 期間沒有 CMS 寫入。
3. 將資料庫備份與 `.sha256` 寫入 `CMS_BACKUP_DIR`，並執行 `pg_restore --list` 驗證。
4. 執行 `alembic upgrade head`。
5. 啟動一個新容器，uvicorn 只監聽 `127.0.0.1:CMS_PORT`。
6. 檢查 `/healthz`。失敗時停止新容器。

所有容器都以唯讀檔案系統、移除全部 Linux capabilities、`no-new-privileges` 與最多 256 個 process 執行，並使用 host network。`/tmp` 是每個容器自己的 Docker volume，匯出圖片的暫存檔寫在這裡，不佔用記憶體。CMS 容器的 log 預設保留 5 個 10 MB 檔案，避免占滿磁碟。

備份失敗時，腳本會重新啟動原本的 CMS。Migration 開始後若失敗，腳本保留 CMS 停止狀態，避免舊程式寫入部分變更的 schema。這時先查看 workflow 與資料庫錯誤，再決定修正 migration 或還原備份。腳本不會自動還原資料庫。

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

## 3. 排程與鎖

雲端的 CMS 一直開著，清理與備份由主機排程執行 `cloud-maintenance.sh`：每小時 `maintenance`，每天 03:30 `backup`。EC2 的主機設定腳本會寫好排程，Tailscale 做法要自己設定（`cloud-tailscale.md` 第 6 節）。這個腳本在目前執行中的容器內執行工作，所以使用的程式與設定和 CMS 相同。

部署、排程與 `cloud-restore.sh` 共用 `CMS_BACKUP_DIR/.cms-deploy.lock`。同時執行時，較晚取得鎖的工作會失敗，排程監控應記錄非零結束碼。所以不要在 03:30 前後推送 `cms-v*` tag，否則當天的備份會放棄。

## 4. 使用 AWS 服務（選用）

### 把 log 送到 CloudWatch Logs

先建立 log group，設定保存天數，並給 instance role `logs:CreateLogStream` 與 `logs:PutLogEvents`。EC2 的 stack 已經建立 log group 與權限。再設定 `CMS_LOG_GROUP` 與 `CMS_LOG_REGION`，下次部署後 CMS 容器改用 Docker 的 `awslogs` driver，stream 名稱是容器名稱。主機上的 `docker logs` 仍可使用。

啟用前先在主機確認 Docker 可以寫入 log group。這個步驟失敗時，部署會在 migration 之後停下，CMS 維持停止。

```sh
docker run --rm --log-driver awslogs --log-opt awslogs-group=<log group> \
  --log-opt awslogs-region=<region> --log-opt awslogs-stream=test hello-world
```

### 使用 RDS

RDS 需要驗證伺服器憑證。下載 [RDS 的 CA bundle](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) 存成 `/srv/blog/secrets/rds-global-bundle.pem`，讓 UID 1000 可讀，再在 `DATABASE_URL` 加上以下參數。

```dotenv
DATABASE_URL=postgresql+psycopg://<user>:<password>@<endpoint>:5432/<db>?sslmode=verify-full&sslrootcert=/run/secrets/rds-global-bundle.pem
```

CMS、migration 與 `backup.sh` 都使用這個設定。這個做法已用自簽 CA 的 PostgreSQL 實測，正確的 CA 可以連線與備份，錯誤的 CA 會被拒絕。尚未對真正的 RDS 實測。

`backup.sh` 與 `restore.sh` 也支援 `--url`，從自己的電腦直接對任何 PostgreSQL 備份或還原。這個模式需要本機裝有和資料庫同一個大版本（目前是 16）的 PostgreSQL 用戶端工具（`pg_dump`、`pg_restore`、`psql`）。密碼會透過 `PGPASSWORD` 傳給這些工具，不會出現在它們的命令列。`--url` 的網址本身仍會出現在 `backup.sh`／`restore.sh` 的命令列；不想這樣時改用 `--env`，從環境變數或 `.env` 的 `DATABASE_URL` 讀取。

```sh
scripts/restore.sh backups/<檔名>.dump --url 'postgresql+psycopg://<user>:<password>@<endpoint>:5432/<db>'
```

## 5. 還原

`backend/scripts/cloud-restore.sh` 把一份 `backup.sh` 的備份還原到雲端 CMS 的資料庫。備份已經在主機的備份目錄時用 `--dump`：

```sh
sudo bash backend/scripts/cloud-restore.sh --dump /srv/blog/backups/<檔名>.dump \
  --env-file /srv/blog/cms.env --backup-dir /srv/blog/backups --secrets-dir /srv/blog/secrets
```

備份在別處時，用 `--url '<https 網址>' --sha256 <checksum>` 下載到備份目錄，例如 S3 的 presigned 網址（`cloud-ec2.md` 第 8 節）。

腳本使用和部署相同的鎖，所以不會和部署或排程同時進行。備份旁有 `.sha256` 時先驗證 checksum，再停止 CMS，用 CMS 容器的 image 執行 `scripts/restore.sh`。`restore.sh` 會先備份目前的資料，再取代整個資料庫並執行 migration。完成後腳本重新啟動 CMS，檢查 `/healthz`。還原失敗時 CMS 保持停止，錯誤訊息會列出重試的指令。還沒部署過 CMS 時，腳本拒絕執行。

先在獨立的測試資料庫演練。還原使用目前 CMS 容器的 image，它要能讀取備份的 schema。不要只換成舊 image 就假設資料庫 schema 也已經回復。

## 6. 驗證部署腳本

在 repo 根目錄執行。

```sh
bash -n backend/scripts/deploy-cloud.sh backend/scripts/cloud-maintenance.sh backend/scripts/ssm-env.sh \
  backend/scripts/cloud-host-setup.sh backend/scripts/cloud-restore.sh
python backend/scripts/test-cloud-deploy.py
cfn-lint infra/aws/cms-ec2.yaml
```

測試以假的 Docker 與 AWS CLI 驗證執行順序、備份失敗恢復、migration 失敗停止、容器限制、參數檢查，以及 SSM 環境檔的產生。同一個檔案也測試 `cloud-host-setup.sh`（重複執行、密碼與 tunnel token 不出現在指令列、cron 內容）與 `cloud-restore.sh`（執行順序、鎖、沒有 CMS 容器時拒絕、checksum）。`cfn-lint` 用 `pip install cfn-lint` 安裝。2026-10-24 另在 Linux Docker 上實際部署過一次本機 registry 的 image，確認唯讀容器可以 migration、備份、維護、上傳暫存檔並通過健康檢查。2026-10-31 作者在 EC2 上實際走完一次（`cloud-ec2.md`）：建立 stack、設定主機、經 SSM 部署、還原備份與「更新網站」都成功。Tailscale 做法與 RDS 仍沒有實測過。完成主機設定後，自己也要實際走一次部署與還原演練。
