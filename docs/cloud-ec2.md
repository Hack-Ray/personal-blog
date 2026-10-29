# 把 CMS 部署到 AWS EC2（Cloudflare Tunnel 與 SSM）

這份流程是雲端 CMS 的第二種做法。主機是一台 EC2，作者經 Cloudflare Tunnel 與 Cloudflare Access 連到 CMS，GitHub Actions 經 AWS SSM Run Command 部署。主機不開任何進站連接埠，也不需要 SSH 金鑰。

預設的做法仍是 Tailscale（[`cloud-access.md`](cloud-access.md)、[`cms-deployment.md`](cms-deployment.md)）。只有在 `cms-production` environment 設 `CMS_DEPLOY_VIA=ssm` 才使用這份流程。沒有設定時，部署行為不變。容器限制、備份與 migration 的順序和 Tailscale 做法相同，見 `cms-deployment.md` 第 4 節。

以下的 `<網域>`、`<owner>/<repo>`、`<region>` 換成自己的值。

## 1. 整體架構

- `infra/aws/cms-ec2.yaml` 是 CloudFormation template，建立主機與周邊資源。
- `backend/scripts/cloud-host-setup.sh` 在主機上執行一次，安裝 Docker 與排程，啟動 PostgreSQL 與 `cloudflared` 容器。
- `cms-deploy.yml` 在推送 `cms-v*` tag 時建置 image，再用 SSM 在主機上執行 `deploy-cloud.sh`。
- `backend/scripts/cloud-restore.sh` 把既有的備份還原到主機的資料庫。

Stack 建立以下資源。

| 資源 | 內容 |
| --- | --- |
| EC2 主機 | Amazon Linux 2023（x86-64），預設 `t3.small`。IMDSv2 required，hop limit 1。加密的 gp3 磁碟。沒有 key pair |
| Security group | 沒有任何 inbound 規則，只允許對外連線 |
| 主機的 IAM role | SSM 管理（`AmazonSSMManagedInstanceCore`），讀取 SSM 參數，只寫入備份 bucket 的 `cms/`，寫入 log group |
| S3 bucket | 存放備份。封鎖公開存取、加密、開啟版本控制，`BackupRetentionDays` 天後刪除。刪除 stack 時保留 bucket |
| CloudWatch log group | CMS 的 log，保存 `LogRetentionDays` 天 |
| GitHub OIDC provider | 選用。帳號已有 `token.actions.githubusercontent.com` 時設 `CreateGitHubOidcProvider=false` |
| 部署用 IAM role | 只信任 `<owner>/<repo>` 的 `cms-production` environment，只能對這台主機執行 `AWS-RunShellScript` 並讀取結果 |

Hop limit 1 讓 bridge network 的容器（PostgreSQL）拿不到 instance role 的憑證。CMS 與 `cloudflared` 使用 host network，仍可以取得，所以主機 role 只有上表的權限。

## 2. 建立 Cloudflare Tunnel 與 Access

網域要先在 Cloudflare，設定見 [`site-domain.md`](site-domain.md)。

1. 在 Cloudflare Zero Trust 的 **Networks → Tunnels** 建立 tunnel，類型選 **Cloudflared**，由 Cloudflare 管理設定（remotely managed）。
2. 安裝步驟頁面會顯示 tunnel token，先複製下來，第 3 節存進 SSM。不需要照頁面在主機安裝 `cloudflared`，主機設定腳本會用容器執行。
3. 在 tunnel 的 **Public Hostname** 新增 `cms.<網域>`，Service 填 `http://127.0.0.1:8000`。
4. 在 **Access → Applications** 新增 Self-hosted application，網域填 `cms.<網域>`。Policy 的動作選 Allow，只包含作者自己的 email。

Access 必須擋在 CMS 前面。CMS 本身只有一組密碼，沒有 Access 時，任何人都能嘗試登入。之後的 CMS 版本會加上驗證 Access JWT 的設定，作為第二層檢查。

Zone 另外調整兩項設定。

- `site-domain.md` 的 `Security headers` Transform Rule 套用在整個 zone，也會改到 `cms.<網域>` 的回應。把套用範圍改成 **Custom filter expression**，條件是 `http.host eq "<網域>"`。
- 在 **Caching → Cache Rules** 新增規則，條件是 `http.host eq "cms.<網域>"`，動作選 **Bypass cache**。CMS 的回應都不應該由 CDN 快取。

## 3. 在 SSM 建立參數

在自己的電腦或 AWS CloudShell，用作者自己的 AWS 帳號建立以下 SecureString。`/blog/cms` 是預設路徑，可以在 stack 參數改掉。

| 參數 | 內容 |
| --- | --- |
| `/blog/cms/CMS_ENV` | `cloud` |
| `/blog/cms/DATABASE_URL` | `postgresql+psycopg://blog:<密碼>@127.0.0.1:5432/blog`。主機會用這組帳號建立本機的 PostgreSQL 容器 |
| `/blog/cms/ALLOWED_HOSTS` | `cms.<網域>` |
| `/blog/cms/CMS_ORIGIN` | `https://cms.<網域>` |
| `/blog/cms/CMS_GITHUB_TOKEN` 等 | 發布用的 GitHub 設定，和本機的 `.env` 相同，見 `backend/.env.example` |
| `/blog/cloudflared-token` | 第 2 節的 tunnel token |

密碼用 `openssl rand -hex 24` 產生。十六進位字元不需要在網址裡跳脫。

```sh
aws ssm put-parameter --region <region> --type SecureString --name /blog/cms/CMS_ENV --value cloud
aws ssm put-parameter --region <region> --type SecureString --name /blog/cms/DATABASE_URL \
  --value "postgresql+psycopg://blog:$(openssl rand -hex 24)@127.0.0.1:5432/blog"
```

`BACKUP_TARGET` 不用設定。主機的 cron 每天把備份寫到 `/srv/blog/backups`，再同步到 S3。

使用 GitHub App 時，私鑰存成 `/blog/cms-github-app-pem`（`<路徑>-github-app-pem`），第 5 節的主機設定腳本加上 `--github-app-pem-param /blog/cms-github-app-pem`，會把它寫成 `/srv/blog/secrets/github-app.pem`。`/blog/cms/GITHUB_APP_PRIVATE_KEY_FILE` 設成容器內的路徑 `/run/secrets/github-app.pem`，GitHub 的 `CMS_SECRETS_DIR` 也要設定。其他 App 設定見 `portable-cms.md`。改用 RDS 時，`DATABASE_URL` 指向 RDS，主機設定腳本就不會建立本機的 PostgreSQL。

## 4. 建立 CloudFormation stack

Subnet 必須是 public subnet，也就是 route table 有指向 internet gateway 的路由。主機會拿到一個 public IP，只用來對外連線。沒有 inbound 規則，所以外面連不進來。

```sh
aws cloudformation deploy --region <region> --stack-name blog-cms \
  --template-file infra/aws/cms-ec2.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides GitHubRepository=<owner>/<repo> VpcId=<vpc-id> SubnetId=<subnet-id>
aws cloudformation describe-stacks --region <region> --stack-name blog-cms --query 'Stacks[0].Outputs'
```

`GitHubRepository` 的大小寫要和 GitHub 上的 repo 名稱一致，否則 GitHub 取不到部署 role。記下 Outputs 的 `InstanceId`、`DeployRoleArn`、`BackupTarget` 與 `LogGroup`。

`ImageId` 預設讀取最新的 Amazon Linux 2023 AMI。之後每次更新 stack 都會重新讀取，AMI 改版時 CloudFormation 會建立一台新主機。舊主機與它的資料庫會保留下來，不會被終止，但 stack 之後指向沒有資料的新主機。建立後先查出目前的 AMI ID，之後更新 stack 時把它填進 `ImageId`。

## 5. 設定主機

在 EC2 主控台選這台主機，用 **Connect → Session Manager** 登入。主機沒有 Git，先安裝再 clone 程式 repo。

```sh
sudo dnf install -y git
git clone https://github.com/<owner>/<repo>.git
sudo bash <repo>/backend/scripts/cloud-host-setup.sh --region <region> \
  --s3 <BackupTarget> --tunnel-token-param /blog/cloudflared-token
```

腳本做以下幾件事，重複執行也安全。

1. 安裝 Docker、cron、`dnf-automatic` 與 Git，啟動 Docker 與 cron。`dnf-automatic` 設成每天自動套用安全更新。核心更新要重新開機才生效，腳本不會自動重開。
2. 建立 `/srv/blog/backups` 與 `/srv/blog/secrets`，複製 `cloud-maintenance.sh` 與 `ssm-env.sh`。有 `--github-app-pem-param` 時，從 SSM 取出 GitHub App 私鑰，寫成只有 CMS 容器使用者（UID 1000）能讀的 `/srv/blog/secrets/github-app.pem`。
3. 從 SSM 產生權限 600 的 `/srv/blog/cms.env`。
4. `DATABASE_URL` 指向 `127.0.0.1` 時，建立 PostgreSQL 16 容器 `blog-db`，資料放在 volume `blog-pgdata`，只發布在主機的 `127.0.0.1:5432`。容器已經存在時只啟動它，不改資料與密碼。
5. 寫入 `/etc/cron.d/blog-cms`。每小時執行維護，每天 03:00（UTC）備份並同步到 S3。輸出記在 journal，用 `journalctl -t blog-cms-backup` 查看。
6. 從 SSM 讀取 tunnel token，寫入權限 600 的 `/etc/cloudflared/token.env`，啟動 `blog-cloudflared` 容器。容器使用 host network、唯讀檔案系統、移除全部 capabilities。Token 只在這個檔案裡，不出現在指令列。Token 或 image 改變時，腳本重建容器，否則保留原本的容器。Image 預設是固定版本的 `cloudflare/cloudflared`，用 `--cloudflared-image` 可以換成其他版本。

這時 tunnel 已經連上，但 CMS 還沒部署，`https://cms.<網域>` 會回傳錯誤。

## 6. 設定 GitHub

在程式 repo 的 `cms-production` environment 設定以下 variables。`CMS_DEPLOY_ENABLED=true` 仍放在 repository variables。Tag ruleset、environment 的部署限制與 GHCR package 的公開設定，照 `cms-deployment.md` 第 3 節做。

| Variable | 內容 |
| --- | --- |
| `CMS_DEPLOY_VIA` | `ssm` |
| `CMS_AWS_ROLE_ARN` | Outputs 的 `DeployRoleArn` |
| `CMS_AWS_REGION` | Stack 所在的 region |
| `CMS_INSTANCE_ID` | Outputs 的 `InstanceId` |
| `CMS_ENV_FILE` | `/srv/blog/cms.env` |
| `CMS_BACKUP_DIR` | `/srv/blog/backups` |
| `CMS_SECRETS_DIR` | 選用。`/srv/blog/secrets` |
| `CMS_LOG_GROUP`、`CMS_LOG_REGION` | 選用。Outputs 的 `LogGroup` 與 region |

`CMS_HOST`、`CMS_SSH_USER` 與 Tailscale 的 secrets 不需要設定。

## 7. 第一次部署

```sh
git tag cms-v1.0.0
git push origin cms-v1.0.0
```

Workflow 以 OIDC 取得短期 AWS 憑證，把 `deploy-cloud.sh` 與參數送到主機執行，再每 10 秒查詢一次結果，最多等 35 分鐘。主機上的輸出會顯示在 workflow log。腳本失敗或逾時時，workflow 也會失敗。逾時的指令不會被取消，可以在 Systems Manager 的 **Run Command → Command history** 查看。

部署完成後，用 Session Manager 設定管理員密碼。

```sh
sudo docker exec -it blog-cms python -m blog.auth
```

接著開啟 `https://cms.<網域>/admin/`，Access 驗證作者的 email 後才會顯示登入頁。

## 8. 搬移資料

同一時間只啟動一個 CMS。先停止本機 CMS，再用 `backend/scripts/backup.sh` 做一份備份。主機 role 不能讀取 bucket，所以用作者自己的帳號上傳，再產生一個短期的下載網址。

```sh
aws s3 cp backend/backups/blog-<時間>.dump s3://<bucket>/import/
aws s3 presign s3://<bucket>/import/blog-<時間>.dump --expires-in 900 --region <region>
cat backend/backups/blog-<時間>.dump.sha256
```

在主機上執行還原。`--sha256` 填 `.sha256` 檔案的第一欄。

```sh
sudo bash <repo>/backend/scripts/cloud-restore.sh --url '<presign 產生的網址>' --sha256 <checksum> \
  --env-file /srv/blog/cms.env --backup-dir /srv/blog/backups --secrets-dir /srv/blog/secrets
```

腳本使用和部署相同的鎖，所以不會和部署或排程同時進行。它先下載備份並驗證 checksum，再停止 CMS，用 CMS 容器的 image 執行 `scripts/restore.sh`。`restore.sh` 會先備份目前的資料，再取代整個資料庫並執行 migration。完成後腳本重新啟動 CMS，檢查 `/healthz`。還原失敗時 CMS 保持停止，錯誤訊息會列出重試的指令。還沒部署過 CMS 時，腳本拒絕執行。

網址含有暫時的簽章，只在 15 分鐘內有效。腳本透過 curl 的設定檔讀取網址，不放在指令列。

## 9. 日常維運

- **更新設定。** 修改 SSM 參數後，在主機重新執行 `cloud-host-setup.sh` 產生 `cms.env`，再推送新的 `cms-v*` tag。執行中的容器不會讀取新值。
- **更換 tunnel token。** 更新 `/blog/cloudflared-token`，再重新執行 `cloud-host-setup.sh`。
- **還原主機上的備份。** 用 `cloud-restore.sh --dump /srv/blog/backups/<檔名>.dump`，其他參數和第 8 節相同。
- **檢查備份。** `aws s3 ls <BackupTarget>` 應該每天多一份 `.dump` 與 `.sha256`。

## 10. 回到原本的做法

- **回到上一版 CMS。** 推送指向舊 commit 的新 tag，例如 `git tag cms-v1.0.1 <舊 commit>`。Migration 不會倒退，舊程式要能使用新的 schema。不確定時，先用部署前的備份還原，見第 8 節。
- **改回 Tailscale。** 把 `CMS_DEPLOY_VIA` 刪掉或設成 `tailscale`，並設定 `cms-deployment.md` 的 Tailscale variables。
- **回到本機。** 在主機執行 `sudo bash /srv/blog/cloud-maintenance.sh backup blog-cms /srv/blog/backups <BackupTarget>`，再停止主機上的 CMS（`sudo docker stop blog-cms`）。用作者自己的帳號從 `<BackupTarget>` 下載這份備份，用本機的 `restore.sh` 還原。
- **刪除 stack。** 刪除後主機與資料庫一起消失，S3 bucket 與裡面的備份會保留，要自己刪除。

## 11. 費用（概估）

以下是 2026 年的粗略估計，實際以 AWS 定價為準。`t3.small` 全月約 US$15，20 GB gp3 約 US$2，public IPv4 位址約 US$4，S3、CloudWatch Logs 與 SSM 在個人使用量下通常不到 US$1。合計每月約 US$20。Cloudflare Tunnel 與 Access 的免費方案就夠用。

## 12. 驗證腳本

`cms-deployment.md` 第 8 節的測試也涵蓋主機設定與還原腳本。CloudFormation template 用 `cfn-lint infra/aws/cms-ec2.yaml` 檢查。這些檢查都使用假的 AWS、Docker 與 Cloudflare。真正的 EC2、SSM Run Command、Cloudflare Tunnel 與還原尚未實測，第一次設定後要實際走一次部署與還原。
