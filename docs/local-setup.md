# 本機執行教學：CMS、資料庫與備份還原

這份教學帶你在自己的電腦上把 CMS 跑起來，並說明怎麼備份資料、怎麼在新環境還原。

## 0. 整體架構

| 元件 | 在哪裡執行 | 用途 |
|---|---|---|
| PostgreSQL 16 | Docker 容器 | 存放文章、草稿、版本、快照、圖片、發布紀錄與管理員密碼 |
| FastAPI 後端 + CMS 介面 | 你的電腦（透過 `uv`） | 在 http://127.0.0.1:8000/admin/ 編輯文章 |
| 你的 private 內容 repo（例如 `personal-blog-content`） | 你的電腦上的一份 clone | 「更新網站」時匯出 Snapshot 並 push |
| 公開網站 | GitHub Actions + GitHub Pages | 讀者看到的網站，不依賴你的電腦 |

只有資料庫用 Docker。後端直接在你的電腦上執行，這樣改程式後重新啟動最快。

> **Windows 使用者**：下面的指令與 `scripts/*.sh` 都是 bash。請在 WSL 2（建議）或 Git Bash 中執行。

## 1. 安裝工具（只需做一次）

### 1.1 Docker

- **macOS**：安裝 [Docker Desktop](https://www.docker.com/products/docker-desktop/)（或 `brew install --cask docker`），安裝後打開 Docker Desktop，等狀態列顯示 Docker 正在執行。
- **Windows**：安裝 Docker Desktop，並在設定中啟用 WSL 2 backend。
- **Linux**：安裝 Docker Engine 與 Compose plugin（依你的發行版照 [官方說明](https://docs.docker.com/engine/install/)），並把自己加入 `docker` 群組：`sudo usermod -aG docker $USER`，重新登入後生效。

確認：

```sh
docker --version
docker compose version
docker run --rm hello-world
```

### 1.2 uv（Python 套件與版本管理）

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
uv --version
```

不需要另外裝 Python：`uv sync` 會自動下載符合 `requires-python`（3.12 以上）的版本。

### 1.3 Node.js 22

建議用 [nvm](https://github.com/nvm-sh/nvm)：

```sh
nvm install 22
node --version   # v22.x
```

### 1.4 Git

`git --version` 能執行即可。push 到 GitHub 需要你的認證：用 SSH key，或 `gh auth login`。

## 2. 取得程式碼

```sh
git clone https://github.com/<你的帳號>/personal-blog.git   # 你的 fork；只想試用可直接 clone 原 repo
cd personal-blog
```

以下指令除非特別註明，都在 `backend/` 目錄執行：

```sh
cd backend
```

## 3. 用 Docker 建立資料庫

```sh
docker compose up -d --wait
docker compose ps
```

`--wait` 會等到資料庫健康檢查通過才結束；`docker compose ps` 的 STATUS 應顯示 `healthy`。

說明：

- 資料存在名為 `pgdata` 的 Docker volume 裡。停止或重開容器、重開電腦，資料都還在。
- 資料庫只開放給本機（`127.0.0.1:5432`），帳號密碼 `blog` / `blog` 只在你的電腦上有效。
- `restart: unless-stopped`：Docker 啟動時資料庫會自動啟動，除非你手動停止它。

> ⚠️ **不要執行 `docker compose down -v`**。`-v` 會刪除 `pgdata` volume，也就是刪除所有資料。只想停止時用 `docker compose stop`。

## 4. 設定 `.env`

```sh
cp .env.example .env
```

用編輯器打開 `backend/.env`：

| 變數 | 填什麼 | 何時需要 |
|---|---|---|
| `CMS_ENV` | 保持 `local` | 一定要（留空也是 `local`） |
| `CONTENT_REPO_DIR` | 內容 repo 在你電腦上的 clone 路徑（見第 8 節） | 使用「更新網站」時 |
| `DEPLOY_REPO` | 你的 fork，例如 `you/personal-blog` | 使用「更新網站」時 |
| `CMS_GITHUB_TOKEN` | [`fork-and-deploy.md`](./fork-and-deploy.md) 第 4 步建立的本機 token（舊的 `.env` 叫 `GITHUB_TOKEN`，仍然有效） | 使用「更新網站」時 |

其他設定在本機都有預設值，不用填：`DATABASE_URL`（Docker 的資料庫）、`ALLOWED_HOSTS`（`127.0.0.1,localhost`）、`COOKIE_SECURE`（關）、`ENABLE_DOCS`（開，`/docs` 可看 API 文件）。設定有錯或缺少時，CMS 不會啟動，並在終端機說明是哪一項。

`.env` 已被 `.gitignore` 排除，**不要 commit 它**。

## 5. 安裝後端套件並建立資料表

```sh
uv sync
uv run --env-file .env alembic upgrade head
```

最後應依序看到 `Running upgrade -> 0001` 到最新的 migration（`backend/migrations/versions/` 裡編號最大的檔案）。之後每次拉新程式碼，都再跑一次 `alembic upgrade head`，已套用的 migration 會自動略過。

## 6. 設定管理員密碼

```sh
uv run --env-file .env python -m blog.auth
```

輸入兩次密碼（至少 12 個字元）。忘記密碼時再執行一次即可，所有已登入的瀏覽器會被登出。

## 7. 建置 CMS 介面並啟動

```sh
(cd ../cms && npm ci && npm run build)
uv run --env-file .env uvicorn blog.api:app --host 127.0.0.1 --port 8000
```

打開 http://127.0.0.1:8000/admin/ ，用剛才的密碼登入。API 文件在 http://127.0.0.1:8000/docs 。

`--host 127.0.0.1` 讓 CMS 只接受本機連線，**不要改成 `0.0.0.0`**。

## 8. 讓「更新網站」可以用

「更新網站」需要你自己的內容 repo、GitHub Pages 與兩個 token。步驟見 [`fork-and-deploy.md`](./fork-and-deploy.md) 第 2 到 5 步，完成後在 `backend/.env` 填好 `CONTENT_REPO_DIR`、`DEPLOY_REPO`、`CMS_GITHUB_TOKEN` 並重新啟動後端。

## 9. 日常啟動與關閉

啟動（每次開 CMS 都用這個）：

```sh
cd personal-blog/backend
scripts/start.sh
```

`start.sh` 依序：

1. `docker compose up -d --wait` 啟動資料庫並等到可連線。
2. **自動備份一次**到 `backend/backups/`（見第 10 節）。備份失敗時會顯示警告，但 CMS 仍會啟動；請先處理警告再開始編輯。
3. `alembic upgrade head`：有新的 migration 才會執行。備份在 migration 之前，所以 migration 出問題時可以用備份還原。
4. 啟動 CMS：http://127.0.0.1:8000/admin/

關閉：按 `Ctrl+C`；要連資料庫一起停，再執行 `docker compose stop`。

拉了新程式碼之後，先更新套件與 CMS，再用 `start.sh` 啟動：

```sh
uv sync
(cd ../cms && npm ci && npm run build)
scripts/start.sh
```

CMS 每次啟動時會自動執行到期的清理：待刪除滿 30 天的文章、已上線後不再需要的舊版本、7 天沒有引用的圖片。

## 10. 備份

### 10.1 每次啟動自動備份，也可以手動備份

用 `scripts/start.sh` 啟動時會自動備份一次。想在其他時候備份（例如大量修改之前），手動執行：

```sh
cd personal-blog/backend
scripts/backup.sh
```

每次備份會在 `backend/backups/` 產生兩個檔案：

- `blog-<UTC 時間>.dump`：整個資料庫（PostgreSQL custom format）
- `blog-<UTC 時間>.dump.sha256`：檢查碼，還原時用來確認檔案沒有損壞

腳本寫完後會用 `pg_restore --list` 讀一次備份，讀不了就失敗，不會留下壞掉的檔案。

### 10.2 備份包含什麼

| 包含 | 不包含 |
|---|---|
| 所有文章、Working Draft、Published Version、草稿快照 | `backend/.env`（含 token，請另外安全保存，例如密碼管理器） |
| 所有圖片（存在資料庫裡） | 內容 repo（已在 GitHub 上） |
| Topic、Tag、文章狀態、退役的 docId | 程式碼（在 GitHub 上） |
| 發布紀錄、管理員密碼雜湊、登入 session | |

### 10.3 存放

- `backend/backups/` 已被 `.gitignore` 排除，**不會進 git**。
- **請定期把 `backend/backups/` 裡的檔案複製到雲端硬碟**。只放在同一台電腦上無法防止硬碟損壞或遺失。`.dump` 與 `.sha256` 要一起複製。
- 舊備份不會自動刪除。確認已存到雲端後，可以手動刪除本機較舊的檔案。
- （選用）如果 CMS 很久才開一次，也可以用 cron 另外排程每天備份（`crontab -e` 加入一行，路徑改成你的）：

  ```cron
  0 3 * * * cd /Users/<你>/personal-blog/backend && PATH=/usr/local/bin:/opt/homebrew/bin:$PATH ./scripts/backup.sh >> backups/backup.log 2>&1
  ```

  cron 的 PATH 很短，所以要把 `docker` 所在的目錄加進去（`which docker` 可查）。

## 11. 還原

> ⚠️ 還原會**取代整個資料庫**，備份之後寫入的所有資料都會消失。不確定時先做一次 `scripts/backup.sh`。

```sh
cd personal-blog/backend
scripts/restore.sh backups/blog-20261020T120000Z.dump
```

腳本會：

1. 用 `.sha256` 檢查備份檔沒有損壞（不符就停止）。
2. 要求你輸入 `restore` 確認。
3. 清空資料庫並還原備份。
4. 執行 `alembic upgrade head`，所以舊程式版本的備份也能還原到新版程式。

還原後重新啟動後端即可。管理員密碼與備份當時相同。

## 12. 搬到新電腦

1. 在新電腦完成第 1 到第 4 節（安裝工具、clone、`docker compose up -d --wait`、建立 `.env`）。把舊電腦的 `.env` 內容（token 等）搬過來。
2. `uv sync`
3. 把備份檔與 `.sha256` 複製到新電腦的 `backend/backups/`，執行：

   ```sh
   scripts/restore.sh backups/<檔名>.dump
   ```

4. 第 7 節建置 CMS 並啟動，重新 clone 內容 repo（`git clone https://github.com/<你的帳號>/personal-blog-content.git`）。

不需要再跑第 5、6 節：還原會建立資料表並帶回管理員密碼。

## 13. 之後搬到 AWS

兩個腳本都支援 `--url`，直接對任何 PostgreSQL 備份或還原。這個模式需要本機裝有 PostgreSQL 16 的用戶端工具（`pg_dump`、`pg_restore`、`psql`）。

```sh
# 從本機 Docker 備份
scripts/backup.sh
# 還原到雲端資料庫（例如 RDS），網址與 DATABASE_URL 相同格式
scripts/restore.sh backups/<檔名>.dump --url 'postgresql+psycopg://<user>:<password>@<host>:5432/<db>'
```

在雲端執行 CMS 時，設 `CMS_ENV=cloud`，並填 `DATABASE_URL`、`ALLOWED_HOSTS`、`CMS_ORIGIN`（範例在 `backend/.env.example`）。這時 cookie 自動加上 Secure、回應加上 HSTS，`/docs` 關閉。CMS 必須放在網域的根目錄（例如 `https://cms.<tailnet>.ts.net/admin/`），不能放在子路徑下。監控可以用 `GET /healthz`，它不檢查 Host，會查詢一次資料庫。

## 14. 常見問題

| 狀況 | 原因與處理 |
|---|---|
| `docker compose up` 說 port 5432 已被使用 | 你的電腦已經有 PostgreSQL 在跑。把 `compose.yaml` 的 `127.0.0.1:5432:5432` 改成 `127.0.0.1:5433:5432`，並把 `.env` 的 `DATABASE_URL` 改成 `:5433` |
| `Cannot connect to the Docker daemon` | Docker Desktop 沒開，或 Linux 上 docker 服務沒啟動 |
| `/admin/` 回 404 | 還沒執行第 7 節的 `npm run build` |
| 登入一直說密碼錯誤 | 重新執行 `python -m blog.auth` 設定密碼。連續錯 5 次會鎖 15 分鐘，重啟後端可解除 |
| 更新網站回「CONTENT_REPO_DIR must point at a clone」 | `.env` 沒設 `CONTENT_REPO_DIR`，或路徑不是 git clone；改完要重啟後端 |
| 發布紀錄顯示「無法啟動部署」 | `.env` 沒設 `CMS_GITHUB_TOKEN` 或 `DEPLOY_REPO`，或 token 權限不足（需要 `DEPLOY_REPO` 的 Actions read/write）。修好後按「重試」 |
| 發布紀錄顯示「push 失敗」 | 內容 repo 的 git 認證有問題；在該目錄試 `git push --dry-run`，修好後按「重試」 |

## 15. （選用）執行後端測試

測試會刪除並重建資料表，**請用獨立的測試資料庫**：

```sh
docker compose exec db createdb -U blog blog_test
TEST_DATABASE_URL=postgresql+psycopg://blog:blog@127.0.0.1:5432/blog_test uv run pytest
```
