# Personal Blog

[繁體中文](#繁體中文) · [English](#english)

自架的部落格系統：在自己電腦上的 CMS 寫作，公開網站是部署在 GitHub Pages 的靜態網站。CMS 也可透過設定改在雲端執行，見 [`docs/portable-cms.md`](docs/portable-cms.md)。Fork 之後不需要改程式，照 [`docs/fork-and-deploy.md`](docs/fork-and-deploy.md) 設定就能架出自己的部落格。

A self-hosted blog: you write in a CMS that runs on your own computer, and the public site is a static site on GitHub Pages. A fork needs no code changes; [`docs/fork-and-deploy.md`](docs/fork-and-deploy.md) (in Traditional Chinese) walks from the fork to the first published article.

範例 / Example: <https://hack-ray.github.io/personal-blog/>

---

## 繁體中文

### 架構

```text
你的電腦                                   GitHub
┌─────────────────────────────┐          ┌──────────────────────────────────┐
│ CMS 介面 (cms/)              │          │ 內容 repo（private）             │
│   ↓ /api                    │  push    │   manifest.json、profile.json、   │
│ 後端 (backend/) ── PostgreSQL│ ───────→ │   articles/、images/              │
│   「更新網站」匯出 Snapshot   │          └───────────────┬──────────────────┘
└──────────────┬──────────────┘                          │ checkout
               │ 啟動 Deploy site workflow                ↓
               └────────────────────────→ GitHub Actions：CI → 建置 frontend/ → GitHub Pages
```

| 目錄 | 內容 | 技術 |
| --- | --- | --- |
| `backend/` | 本機 CMS API。保存草稿、已發布版本、草稿快照、圖片與登入資料，並負責「更新網站」。 | Python 3.12+、FastAPI、PostgreSQL 16、SQLAlchemy、Alembic、uv |
| `cms/` | CMS 介面，由後端在 `/admin/` 提供。 | Vite、React、TypeScript |
| `frontend/` | 公開網站，從內容 Snapshot 產生靜態頁面。 | Next.js（`output: "export"`）、TypeScript、marked、shiki |
| `docs/` | Fork 與部署教學、本機安裝步驟、作者的部署紀錄；`docs/architecture/` 是架構導覽（系統怎麼運作、為什麼這樣設計）；`docs/design/` 是設計紀錄（Baseline 與 Addendum 01–04）。 | |
| `.github/workflows/` | `ci.yml` 跑三組測試；`deploy.yml` 建置並部署網站。 | GitHub Actions |

網站內容不在這個 repo，而在你自己建立的 private 內容 repo。發布流程：

1. 在 CMS 按「發布」：在資料庫建立一個新的 Published Version。這一步不會改變網站。
2. 在「網站發布」頁按「更新網站」：後端把所有已發布文章、網站名稱與簡介、關於頁匯出成 Snapshot（`manifest.json`、`profile.json`、`articles/`、`images/`），commit 並 push 到內容 repo，再啟動 `Deploy site` workflow。
3. `.github/workflows/deploy.yml` 先跑 CI，再以這份 Snapshot 建置 `frontend/`，部署到 GitHub Pages。CMS 會追蹤這次部署，顯示成功或失敗。

後端與前端之間只透過 Snapshot 溝通，格式以 `frontend/src/content/parse.ts` 為準；後端測試會用它驗證匯出結果。

### 優勢

- **讀者端快又安全。** 公開網站是預先產生的 HTML，沒有伺服器與資料庫可以被攻擊，也不需要主機費用。
- **CMS 只在你的電腦上。** 後端只綁定 `127.0.0.1`，以 scrypt 雜湊保存密碼，Session cookie 為 `HttpOnly`、`SameSite=Strict`，閒置 1 天或登入滿 3 天就要重新登入，也可以從介面登出所有裝置。同一個來源連續 5 次密碼錯誤後要等待，之後每錯一次等待時間加倍（最長 15 分鐘），其他來源不受影響。CMS 拒絕跨來源寫入與白名單以外的 Host，回應帶 CSP 等安全標頭。
- **不怕寫壞或誤刪。** 草稿自動儲存並保留快照，可以還原；發布會產生新版本而不覆蓋舊版本；刪除的文章保留 30 天可以復原。
- **壞掉的內容不會上線。** 建置時會檢查 Snapshot 是否完整（版本一致、圖片都在），任何一項不符就停止部署；CI 沒過也不部署。
- **網址穩定。** 文章網址預設是不會改變的 ULID（`/posts/<docId>/`），也可以在 CMS 設定英文 slug（`/posts/<slug>/`）。上線過的舊網址會留下轉址頁，giscus 留言一律綁 ULID，改標題或 slug 都不會讓連結或留言失效。
- **讀者功能齊全。** 程式碼高亮（淺色與深色）、目錄、上一篇與下一篇、主題與標籤頁、站內搜尋、RSS、深淺色切換、Open Graph 與 giscus 留言。
- **圖片自動處理。** 上傳的圖片依內容判斷格式，縮到最寬 1440px 並轉成 WebP，同時移除 EXIF（例如照片的 GPS 位置）。沒被引用超過 7 天的圖片會自動清除。
- **內容與程式分開。** 內容在獨立的 private repo，有完整的 git 歷史；程式碼可以公開，也可以換掉整個前端而不動內容。

### git clone 之後怎麼用

需要的工具：Docker、[uv](https://docs.astral.sh/uv/)、Node.js 22、Git。完整步驟（含 Windows 說明、備份與還原、搬到新電腦）在 [`docs/local-setup.md`](docs/local-setup.md)。

#### 1. 只看公開網站（不需要資料庫）

```sh
git clone https://github.com/<你的帳號>/personal-blog.git   # 你的 fork
cd personal-blog/frontend
npm ci
BASE_PATH= npm run build      # 用 sample-site-data/ 的範例內容建置到 out/，網址從根路徑開始
python3 -m http.server --directory out 3000         # 打開 http://localhost:3000/
```

不設 `BASE_PATH` 時，網站建置在 `/personal-blog/` 底下（部署時改用你的 Pages 網址）。要用自己的內容建置，設定 `SITE_DATA_DIR=/path/to/content`。

#### 2. 在本機跑 CMS 寫文章

```sh
cd personal-blog/backend
docker compose up -d --wait                          # PostgreSQL 16，只開放 127.0.0.1:5432
cp .env.example .env                                 # 之後填 CONTENT_REPO_DIR、DEPLOY_REPO 與 CMS_GITHUB_TOKEN
uv sync
uv run --env-file .env alembic upgrade head          # 建立資料表
uv run --env-file .env python -m blog.auth           # 設定管理員密碼（至少 12 字元）
(cd ../cms && npm ci && npm run build)
uv run --env-file .env uvicorn blog.api:app --host 127.0.0.1 --port 8000
```

打開 <http://127.0.0.1:8000/admin/> 登入。請保持 `--host 127.0.0.1`，不要改成 `0.0.0.0`。之後平常用 `scripts/start.sh` 啟動，它會先備份、執行 migration 與到期的清理（見 [`docs/local-setup.md`](docs/local-setup.md) 第 9 節）。

要使用「更新網站」，還需要內容 repo 的本機 clone（`CONTENT_REPO_DIR`）、你的 fork（`DEPLOY_REPO`）與 GitHub token（`CMS_GITHUB_TOKEN`），設定方式見 [`docs/fork-and-deploy.md`](docs/fork-and-deploy.md)。

#### 3. 改成你自己的部落格

Fork 後不需要改程式，只要設定以下項目（從 Fork 到發布第一篇文章的完整步驟見 [`docs/fork-and-deploy.md`](docs/fork-and-deploy.md)）：

| 位置 | 要設定的內容 |
| --- | --- |
| 你的 GitHub 帳號 | 建立 private 內容 repo，預設名稱是 `<fork 名稱>-content`，例如 `you/personal-blog-content` |
| repo 的 Settings → Pages | Source 選 GitHub Actions。網站網址與 basePath 由 Pages 決定，自訂網域也一樣 |
| repo 的 Actions secret `CONTENT_REPO_TOKEN` | 可以讀取你的內容 repo 的 token |
| repo 的 Actions variable `CONTENT_REPO`（選用） | 內容 repo 不叫 `<fork 名稱>-content` 時才需要 |
| repo 的 Actions variables `GISCUS_REPO_ID`、`GISCUS_CATEGORY_ID`（選用） | 從 <https://giscus.app> 取得；沒設定就不顯示留言 |
| `backend/.env` 的 `DEPLOY_REPO` | 你的 fork，例如 `you/personal-blog` |

文件只寫作者自己使用的做法：CMS 跑在本機，網站部署到 GitHub Pages。CMS 的本機與雲端設定、API 發布及 GitHub App 認證見 [`docs/portable-cms.md`](docs/portable-cms.md)。

網站名稱、簡介、關於頁與頁尾在 CMS 的「網站與關於」頁編輯，第一次發布前請換掉預設的 `Your Name`。

#### 4. 開發與測試

CI（`.github/workflows/ci.yml`）在每個 pull request 與每次 push 到 `main`（由 `deploy.yml` 呼叫）執行以下三組測試：

```sh
# backend：需要 PostgreSQL 與 Node 22（契約測試會執行前端的 Snapshot parser）
cd backend && uv run ruff check && uv run ruff format --check && TEST_DATABASE_URL=postgresql+psycopg://blog:blog@127.0.0.1:5432/blog_test uv run pytest

# cms
cd cms && npm ci && npm test && npm run build

# frontend：以 frontend/sample-site-data 的範例內容建置
cd frontend && npm ci && npm test && npm run typecheck && npm run build
```

開發 CMS 介面時，可以在 `cms/` 執行 `npm run dev`，Vite 會把 `/api` 轉給 `127.0.0.1:8000` 的後端。

合併到你的 fork 的 `main` 時，有改到 `frontend/`、`.nvmrc` 或 `deploy.yml` 才會重新部署網站，其他修改只跑 CI。各部分的細節：[`backend/README.md`](backend/README.md)、[`frontend/README.md`](frontend/README.md)、[`cms/README.md`](cms/README.md)。

#### 5. 跟上原 repo 的更新

Fork 不會自動更新，要由你把原 repo 的新版本拉進來。原 repo 發布新版本時，`scripts/start.sh` 啟動時會顯示一行提醒（見下方）。

1. 在你的 fork 頁面按 **Sync fork** → **Update branch**。也可以用指令：

   ```sh
   gh repo sync <你的帳號>/personal-blog -b main
   ```

   或用 git，第一次先加上原 repo：

   ```sh
   git remote add upstream https://github.com/Hack-Ray/personal-blog.git
   git fetch upstream
   git checkout main
   git merge upstream/main
   git push origin main
   ```

2. 在本機拉下更新，更新套件後重新啟動（[`docs/local-setup.md`](docs/local-setup.md) 第 9 節）：

   ```sh
   git pull
   cd backend && uv sync && (cd ../cms && npm ci && npm run build) && scripts/start.sh
   ```

   `start.sh` 會先備份再執行新的 migration，所以 migration 出問題時可以還原。

建議：

- 讓 fork 的 `main` 和原 repo 一致，你自己的修改放在別的分支，同步後再 `git rebase main`。這樣同步時很少衝突。按 Sync fork 遇到衝突時，GitHub 會請你在本機處理。
- 同步到 fork 的 `main` 也算一次 push：有改到 `frontend/`、`.nvmrc` 或 `deploy.yml` 時會重新部署你的網站。
- 更新前先看 [Releases](https://github.com/Hack-Ray/personal-blog/releases) 的說明，確認有沒有要改的設定。也可以在原 repo 按 **Watch → Custom → Releases**，有新版本時收到通知。

`start.sh` 的提醒只顯示訊息，不會改動程式碼。它向 GitHub 查詢 `Hack-Ray/personal-blog` 的最新 release，比 `backend/pyproject.toml` 的版本新時才顯示；離線或查詢失敗時不顯示，最多等 3 秒。要查詢別的 repo，在 `backend/.env` 設定 `UPDATE_CHECK_REPO=<owner>/<repo>`；設成 `off` 則停用。

---

## English

### Architecture

```text
Your computer                              GitHub
┌─────────────────────────────┐          ┌──────────────────────────────────┐
│ CMS UI (cms/)                │          │ content repo (private)           │
│   ↓ /api                    │  push    │   manifest.json, profile.json,   │
│ Backend (backend/) ─ Postgres│ ───────→ │   articles/, images/             │
│   "Update site" exports      │          └───────────────┬──────────────────┘
│   a Snapshot                 │                          │ checkout
└──────────────┬──────────────┘                          ↓
               │ starts the Deploy site workflow
               └────────────────────────→ GitHub Actions: CI → build frontend/ → GitHub Pages
```

| Directory | What it holds | Stack |
| --- | --- | --- |
| `backend/` | The local CMS API. Stores drafts, published versions, draft snapshots, images and the sign-in, and runs "更新網站" (Update site). | Python 3.12+, FastAPI, PostgreSQL 16, SQLAlchemy, Alembic, uv |
| `cms/` | The CMS UI, served by the backend at `/admin/`. | Vite, React, TypeScript |
| `frontend/` | The public site, generated as static pages from a content Snapshot. | Next.js (`output: "export"`), TypeScript, marked, shiki |
| `docs/` | Fork and deploy guide, local setup guide, the author's deployment notes; `docs/architecture/` is the architecture guide (how the system works and why it is built this way); `docs/design/` holds the design record (Baseline and Addendum 01–04). Written in Traditional Chinese. | |
| `.github/workflows/` | `ci.yml` runs the three test suites; `deploy.yml` builds and deploys the site. | GitHub Actions |

The site's content does not live in this repo. It lives in a private content repo you create. Publishing works like this:

1. Press "發布" (Publish) in the CMS. This creates a new Published Version in the database and does not change the site.
2. Press "更新網站" (Update site) on the "網站發布" (Releases) page. The backend exports every published article, the site name and description, and the About page as a Snapshot (`manifest.json`, `profile.json`, `articles/`, `images/`), commits and pushes it to the content repo, and starts the `Deploy site` workflow.
3. `.github/workflows/deploy.yml` runs CI, builds `frontend/` from that Snapshot, and deploys it to GitHub Pages. The CMS follows the run and shows whether it succeeded.

The backend and the frontend talk only through the Snapshot. `frontend/src/content/parse.ts` defines its format, and the backend tests run that parser on their exports.

### Advantages

- **Fast and safe for readers.** The public site is prebuilt HTML. There is no server or database to attack and no hosting bill.
- **The CMS stays on your computer.** The backend binds only to `127.0.0.1` and stores the password as a scrypt hash. The session cookie is `HttpOnly` and `SameSite=Strict`; a session ends after a day idle or three days in total, and the CMS can sign out every device. After five wrong passwords, that client address must wait, and each further failure doubles the wait (up to 15 minutes) without locking out other addresses. Cross-origin writes and Host headers outside the allow list are refused, and responses carry a CSP and other security headers.
- **Hard to lose work.** Drafts autosave and keep snapshots you can restore. Publishing adds a new version instead of overwriting the old one. A deleted article can be restored for 30 days.
- **Broken content never goes live.** The build checks that the Snapshot is complete (matching versions, every image present) and stops the deploy if anything is off. A failing CI run also stops it.
- **Stable URLs.** Articles live at a fixed ULID (`/posts/<docId>/`) or at an English slug set in the CMS (`/posts/<slug>/`). Every URL that went live keeps a redirect page, and giscus comments stay keyed on the ULID, so changing a title or slug breaks neither links nor comments.
- **Reader features.** Code highlighting in light and dark themes, a table of contents, previous and next links, topic and tag pages, site search, RSS, a theme toggle, Open Graph tags and giscus comments.
- **Images handled for you.** Uploads are identified by their bytes, scaled to at most 1440px wide and re-encoded as WebP, which also strips EXIF data such as a photo's GPS location. Images nothing has referenced for 7 days are removed.
- **Content separate from code.** Content sits in its own private repo with full git history. The code can be public, and the whole frontend could be replaced without touching the content.

### Using the project after `git clone`

You need Docker, [uv](https://docs.astral.sh/uv/), Node.js 22 and Git. The full walkthrough (Windows notes, backup and restore, moving to a new computer) is [`docs/local-setup.md`](docs/local-setup.md), in Traditional Chinese.

#### 1. Just look at the public site (no database)

```sh
git clone https://github.com/<you>/personal-blog.git   # your fork
cd personal-blog/frontend
npm ci
BASE_PATH= npm run build      # builds out/ from the sample content in sample-site-data/, at the root path
python3 -m http.server --directory out 3000         # open http://localhost:3000/
```

Without `BASE_PATH`, the site is built under `/personal-blog/` (the deploy uses your Pages URL instead). To build from your own content, set `SITE_DATA_DIR=/path/to/content`.

#### 2. Run the CMS locally and write

```sh
cd personal-blog/backend
docker compose up -d --wait                          # PostgreSQL 16, reachable only on 127.0.0.1:5432
cp .env.example .env                                 # fill in CONTENT_REPO_DIR, DEPLOY_REPO and CMS_GITHUB_TOKEN later
uv sync
uv run --env-file .env alembic upgrade head          # create the tables
uv run --env-file .env python -m blog.auth           # set the admin password (12+ characters)
(cd ../cms && npm ci && npm run build)
uv run --env-file .env uvicorn blog.api:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000/admin/> and sign in. Keep `--host 127.0.0.1`; do not change it to `0.0.0.0`. After this, start it with `scripts/start.sh`, which backs up, migrates and runs due maintenance first (see [`docs/local-setup.md`](docs/local-setup.md) section 9).

"更新網站" (Update site) also needs a local clone of the content repo (`CONTENT_REPO_DIR`), your fork (`DEPLOY_REPO`) and a GitHub token (`CMS_GITHUB_TOKEN`). [`docs/fork-and-deploy.md`](docs/fork-and-deploy.md) explains how to set them up.

#### 3. Make it your own blog

A fork needs no code changes, only these settings ([`docs/fork-and-deploy.md`](docs/fork-and-deploy.md), in Traditional Chinese, walks from the fork to the first published article):

| Where | What to set |
| --- | --- |
| Your GitHub account | Create a private content repo, by default named `<fork name>-content`, e.g. `you/personal-blog-content` |
| Repo Settings → Pages | Set Source to GitHub Actions. Pages decides the site URL and basePath, custom domains included |
| Actions secret `CONTENT_REPO_TOKEN` | A token that can read your content repo |
| Actions variable `CONTENT_REPO` (optional) | Only when the content repo is not named `<fork name>-content` |
| Actions variables `GISCUS_REPO_ID`, `GISCUS_CATEGORY_ID` (optional) | From <https://giscus.app>; without them the site has no comments |
| `DEPLOY_REPO` in `backend/.env` | Your fork, e.g. `you/personal-blog` |

The default setup runs the CMS locally and deploys the public site to GitHub Pages. The same CMS can run in the cloud with environment settings. See [`docs/portable-cms.md`](docs/portable-cms.md) for API publishing and GitHub App authentication.

The site name, description, About page and footer are edited in the CMS on the "網站與關於" (Site and About) page. Replace the placeholder `Your Name` before the first release.

#### 4. Develop and test

CI (`.github/workflows/ci.yml`) runs these three suites on every pull request and on every push to `main` (called from `deploy.yml`):

```sh
# backend: needs PostgreSQL and Node 22 (a contract test runs the frontend's Snapshot parser)
cd backend && uv run ruff check && uv run ruff format --check && TEST_DATABASE_URL=postgresql+psycopg://blog:blog@127.0.0.1:5432/blog_test uv run pytest

# cms
cd cms && npm ci && npm test && npm run build

# frontend: builds from the sample content in frontend/sample-site-data
cd frontend && npm ci && npm test && npm run typecheck && npm run build
```

While working on the CMS UI, run `npm run dev` in `cms/`. Vite forwards `/api` to the backend on `127.0.0.1:8000`.

A merge into your fork's `main` redeploys the site when it changes `frontend/`, `.nvmrc` or `deploy.yml`; other merges run CI only. Details for each part: [`backend/README.md`](backend/README.md), [`frontend/README.md`](frontend/README.md), [`cms/README.md`](cms/README.md).

#### 5. Keep your fork up to date

A fork does not update itself. You pull in new versions of the original repo. When the original repo publishes a release, `scripts/start.sh` prints a one-line notice at start-up (see below).

1. On your fork's page, press **Sync fork** → **Update branch**. Or run:

   ```sh
   gh repo sync <you>/personal-blog -b main
   ```

   Or use git. The first time, add the original repo as a remote:

   ```sh
   git remote add upstream https://github.com/Hack-Ray/personal-blog.git
   git fetch upstream
   git checkout main
   git merge upstream/main
   git push origin main
   ```

2. Pull the update locally, update the packages and restart ([`docs/local-setup.md`](docs/local-setup.md) section 9):

   ```sh
   git pull
   cd backend && uv sync && (cd ../cms && npm ci && npm run build) && scripts/start.sh
   ```

   `start.sh` backs up before it runs new migrations, so a migration problem can be undone.

Recommendations:

- Keep your fork's `main` identical to the original repo and put your own changes on another branch. After a sync, run `git rebase main`. This keeps syncs free of conflicts. When Sync fork finds a conflict, GitHub asks you to resolve it locally.
- A sync to your fork's `main` is a push. It redeploys your site when it changes `frontend/`, `.nvmrc` or `deploy.yml`.
- Before you update, read the notes on [Releases](https://github.com/Hack-Ray/personal-blog/releases) for settings to change. To get notified, press **Watch → Custom → Releases** on the original repo.

The notice from `start.sh` only prints a message. It never changes your code. It asks GitHub for the latest release of `Hack-Ray/personal-blog` and prints only when that release is newer than the version in `backend/pyproject.toml`. When you are offline or the request fails, it prints nothing, and it waits at most 3 seconds. To check another repo, set `UPDATE_CHECK_REPO=<owner>/<repo>` in `backend/.env`. Set it to `off` to turn the check off.

## License

[MIT](LICENSE)
