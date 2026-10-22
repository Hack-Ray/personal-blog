# 系統如何運作：架構導覽

> **這是導覽，不是規格。** 給要改程式的人快速建立心智模型。設計決策與理由在 [`docs/design/`](../design/)；本機操作在 [`local-setup.md`](../local-setup.md)。內容以 2026-10-22 的程式碼為準，行為有出入時以程式碼為準。

## 本機與雲端共用發布流程

目前 CMS 可透過 CONTENT_TRANSPORT 選擇 git clone 或 Git Data API，並以 PAT 或 GitHub App 認證。「更新網站」先建立持久背景工作並回應 202；worker 匯出一致的 Snapshot，先保存 commit、parent 與內容及部署目的地，再更新遠端分支。重新開啟發布頁會讀回工作狀態。下面提到 clone、Git push 與同步呼叫的段落描述保留的 git 相容模式；CMS 介面使用新的背景工作 API。

API 模式不需要本機 clone 或 Git 身分。工作開始時才擷取當時已發布內容；commit 已準備完成的工作則在重試時接續同一份內容。詳細設定與中斷處理見 [本機與雲端設定](../portable-cms.md)，決策見 Addendum 03 BE-022。

## 1. 概觀

這個專案由五個部分組成。作者在自己電腦上的 CMS 寫文章，資料存在 PostgreSQL。按「更新網站」時，後端把所有已發布內容匯出成一份 JSON Snapshot，commit 並 push 到 private 內容 repo `Hack-Ray/personal-blog-content`，再呼叫 GitHub Actions 的 `deploy.yml`。workflow 把這份 Snapshot 交給 Next.js 建置成純靜態網站，部署到 GitHub Pages。

公開網站在執行期不依賴後端或資料庫。後端只在作者寫作與發布時需要開著。兩邊唯一的介面是內容 repo 裡的 Snapshot 檔案，格式由 `frontend/src/content/parse.ts` 定義。

```mermaid
flowchart LR
  subgraph local["作者的電腦"]
    SPA["CMS SPA<br/>cms/ (React)<br/>/admin"]
    API["FastAPI 後端<br/>backend/blog/"]
    PG[("PostgreSQL 16<br/>文章、版本、圖片、發布紀錄")]
    CLONE["內容 repo 的 clone<br/>CONTENT_REPO_DIR"]
  end
  CONTENT["GitHub: personal-blog-content<br/>(private)"]
  GHA["GitHub Actions<br/>deploy.yml / ci.yml"]
  PAGES["GitHub Pages<br/>公開網站 (frontend/out)"]

  SPA -- "同源 JSON + cookie" --> API
  API --> PG
  API -- "寫檔、git commit" --> CLONE
  CLONE -- "git push（本機 git 認證）" --> CONTENT
  API -- "CMS_GITHUB_TOKEN<br/>dispatch、查 run 狀態" --> GHA
  GHA -- "CONTENT_REPO_TOKEN<br/>checkout content_sha、ls-remote" --> CONTENT
  GHA -- "deploy-pages" --> PAGES
```

兩個 GitHub token 用途不同：

| Token | 放在哪裡 | 權限 | 用途 |
|---|---|---|---|
| `CMS_GITHUB_TOKEN` | 後端 `.env` | 部署 repo 的 Actions 讀寫 | dispatch `deploy.yml`、查 run 與 job 狀態、讀自己的到期日 |
| `CONTENT_REPO_TOKEN` | 部署 repo 的 Actions secret | 內容 repo 的 Contents 唯讀 | build 時 checkout 內容、deploy 前 `ls-remote`、`token-expiry.yml` 檢查 |

push 到內容 repo 不用任何 token，用的是本機 git 的認證（SSH key 或 `gh auth`）。

## 2. 重要概念

- **Article／`doc_id`**：一篇文章。`doc_id` 是大寫 ULID，建立時產生，終身不變，也是公開網址 `/posts/<doc_id>/` 的一部分。永久刪除後 `doc_id` 進入 `retired_doc_ids`，不會再發出。
- **Working Draft 與 revision**：每篇文章恰好一份草稿（`working_drafts`，以 `article_id` 為 PK）。每次寫入 revision +1。所有寫入都帶 `base_revision`，不符就 409。這是整個 CMS 的樂觀鎖。
- **Published Version**：按「發布」時把草稿完整複製一份，版本號 1、2、3 遞增。只能新增，trigger 拒絕 `UPDATE`（例外見 Gotchas）。
- **Draft Snapshot**：自動儲存覆蓋前保留的舊 Markdown，每篇最多 50 份，發布時全部刪除。只是草稿的復原點，與 Content Snapshot 無關。
- **Taxon**：Topic、Tag、Series 的統稱，以 `{slug, name}` 表示。Topic 必填一個，Series 選填一個，Tags 多個。slug 不存在時自動建立。
- **Image id**：`<WebP 內容的 sha256>.webp`。上傳的圖一律轉成 WebP 再算雜湊，相同內容得到相同 id。Markdown 中只有 `images/<id>` 這種寫法算引用。圖片位元組存在 Postgres 的 `image_data`。
- **Content Snapshot**：匯出到內容 repo 的檔案集合：`manifest.json`、`profile.json`、`articles/<doc_id>.json`、`images/`。公開網站唯一的資料來源。
- **Release**：一次「更新網站」。id 是該次 manifest 的 `release_id`（ULID，所以按 id 排序就是時間順序）。記錄內容 repo 的 commit、狀態與 GitHub run。`release_articles` 記錄這次包含哪些 `(article_id, version)`。
- **「發布」與「更新網站」**：兩件不同的事。「發布」只在資料庫建立新的 Published Version，網站不變。「更新網站」把**所有**已發布文章的最新版本與封存清單一起匯出並部署。CMS 發布成功後的訊息會提醒這點。

## 3. 運作方式

### 3.1 請求如何進到後端

後端是單一 ASGI app，`backend/blog/api.py` 的 `app`。它提供：

- `/api/*`：JSON API。
- `/healthz`：`SELECT 1`。
- `/admin`：建置好的 CMS SPA（`StaticFiles(html=True)`，來源 `CMS_DIST`，預設 `../cms/dist`）。只在 import 時目錄存在才掛載。
- `/`：轉址到 `/admin/`。

設定由 `config.py` 的 `load()` 在 import 時讀一次，存成 frozen dataclass `config.settings`。`CMS_ENV=local`（預設）或 `cloud` 只決定預設值：`cloud` 必須設定 `DATABASE_URL`、`ALLOWED_HOSTS`、`CMS_ORIGIN`，並預設 `COOKIE_SECURE=1`、`ENABLE_DOCS=0`。格式錯誤丟 `ConfigError`，`ALLOWED_HOSTS='*'` 會被拒絕。`db.py` 在 import 時建立 engine。

Starlette 依註冊順序的**反向**執行 middleware。`api.py` 依序註冊 `require_admin`、`security_headers`、`trusted_host`，所以請求經過的順序是：

1. **`trusted_host`**：`Host` 不在 `ALLOWED_HOSTS` 回 400。`/healthz` 例外。用來擋 DNS rebinding。
2. **`security_headers`**：回應時對 `/admin*`、`/api/*`、`/` 加上 CSP（`script-src 'self'`、`frame-ancestors 'none'` 等）、`nosniff`、`Referrer-Policy: same-origin`，`COOKIE_SECURE` 時加 HSTS。也替不安全方法的 `/api` 呼叫寫一行 `blog.audit` log。
3. **`require_admin`**：只管 `/api/*`。不安全方法（POST/PUT/PATCH/DELETE）帶了 `Origin` 而且不等於 `CMS_ORIGIN`（未設定時用請求本身的 scheme://netloc）回 403。除了 `/api/session`，其他路徑都要 `auth.is_signed_in()` 通過，否則回 401。這個檢查在 threadpool 裡用自己的 `SessionLocal` 跑。
4. **路由函式**：拿到 `SessionDep` 與 Pydantic body。例如 `DraftBody.content()` 轉成 `articles.DraftContent`，再交給領域模組。

驗證是 middleware 不是 `Depends`，新增路由不用另外加驗證，也無法對單一路由豁免（除非改 `PUBLIC_API`）。

領域例外由 `api.py` 統一對應成 HTTP：

| 例外 | HTTP | 回應附帶 |
|---|---|---|
| `ArticleNotFound`、`TaxonNotFound` | 404 | |
| `RevisionConflict` | 409 | `current_revision` |
| `InvalidTransition` | 409 | `state` |
| `ProfileConflict` | 409 | |
| `TaxonInUse` | 409 | |
| `ExportError`、`ReleaseError`（含 `ReleaseBusy`） | 409 | |
| `NotPublishable`、`InvalidMerge` | 422 | |
| `ImageTooLarge` | 413 | |
| `UnsupportedImage` | 415 | |
| 登入被鎖 `TooManyAttempts` | 429 | `Retry-After` |
| scrypt 忙碌 | 503 | |
| `CONTENT_REPO_DIR` 不是 git clone | 503 | |
| 讀 GitHub token 到期日失敗 | 502 | |

**登入**（`auth.py`）：密碼以 scrypt（N=2^15，約 32 MiB）存在 `admin_credentials` 唯一一列。`sign_in` 先依 `request.client.host` 計失敗次數，先加一再驗密碼。5 次以上失敗後鎖定 `min(15 分鐘, 30 秒 × 2^(n−5))`。scrypt 外面有每個 process 2 個名額的 semaphore，等 10 秒拿不到回 503。成功後刪掉失敗紀錄與過期 session，建立 `admin_sessions`（只存 token 的 sha256）。cookie 為 httponly、`SameSite=Strict`、3 天；`COOKIE_SECURE` 時名稱是 `__Host-cms_session`，否則 `cms_session`。閒置超過 1 天也失效，`last_seen_at` 最多每 5 分鐘寫一次。`set_password` 會登出所有 session。CLI：`python -m blog.auth`。

### 3.2 文章的生命週期

所有寫入都經過 `articles._locked(doc_id, action)`：`SELECT ... FOR UPDATE` 鎖住文章列，檢查 `ALLOWED_FROM[action]`，不允許就丟 `InvalidTransition`（409）。

| 動作 | 允許的起始狀態 | 結果狀態 | 函式 |
|---|---|---|---|
| EDIT（自動儲存、還原快照、置頂） | draft、published、archived | 不變 | `save_draft`、`restore_snapshot`、`set_pinned` |
| PUBLISH | draft、published、archived | published | `publish` |
| ARCHIVE | 只有 published | archived | `archive` |
| DELETE（軟刪除） | draft、published、archived | pending_deletion，記下 `state_before_deletion`、`deleted_at` | `delete` |
| RESTORE | pending_deletion | 回到 `state_before_deletion` | `restore` |
| PURGE（手動，或滿 30 天由維護工作執行） | pending_deletion | 整列刪除，`doc_id` 進 `retired_doc_ids` | `purge`、`purge_expired` |

PURGE 靠 `ON DELETE CASCADE` 一起刪掉草稿、版本、快照與 `release_articles`。

沒有「已發布但有未發布修改」這個狀態。編輯已發布文章時 state 仍是 published，草稿只是領先最新版本。匯出永遠用最新的 Published Version，不看草稿。

**建立**：`create_article` 產生不在 `retired_doc_ids` 中的 ULID，建立 draft 狀態的 Article 與 revision 1 的草稿。

**自動儲存**（`save_draft`）：

1. 鎖定，比對 `base_revision`，不符丟 `RevisionConflict`。
2. `_snapshot_before_overwrite`：Markdown 有變時，在這個編輯週期的第一次、之後最多每 10 分鐘一次、或長度變化 500 字以上時，保留舊內容為 Draft Snapshot。超過 50 份刪最舊的。
3. `_apply` 寫入欄位。Taxon 由 `_get_or_create` 以 `INSERT ... ON CONFLICT (slug) DO UPDATE name` 取得，所以**最後儲存的名稱在所有地方生效**。接著 `images.mark_referenced`。
4. revision +1。

**發布**（`publish`）：請求帶的是作者畫面上的完整內容，不是讀資料庫裡的草稿。

1. 驗證：標題與 Markdown 非空白；cover 必須是文章內引用的圖；所有引用的圖都存在；連結與圖片網址符合網址政策（`url_policy.blocked`）。否則 422。
2. 鎖定並比對 revision，`_apply`，revision +1，狀態改為 published，第一次發布時寫入 `first_published_at`。
3. 新增 Published Version，版本號為目前最大值 +1。
4. 刪除這篇的所有 Draft Snapshot。
5. 回傳 `{version, revision, published_at}`，`revision` 等於 `base_revision + 1`。

連結與圖片網址政策（`url-policy`）有三處把關：後端發布與儲存 profile（`blog/url_policy.py`，違規回 422；profile 只檢查 `intro`）、CMS 的發布按鈕（`urlProblems` 會停用按鈕）、公開網站建置（`parseSnapshot` 的 `blockedUrls`，是最後一道防線）。

**置頂**：`set_pinned` 不建立新版本，下一次「更新網站」才會反映。

**快照還原**：`restore_snapshot` 內部呼叫 `save_draft`，所以還原本身也會先留快照，可以再復原。

**圖片上傳**（`images.store`，`POST /api/images`）：最多讀 10 MB；辨識 PNG、JPEG、GIF、WebP；總像素上限 4000 萬、最多 300 幀；依 EXIF 轉正後去掉 EXIF；寬度最多 1440 px；WebP 品質 85，保留動畫。以內容雜湊為 id，`INSERT ... ON CONFLICT DO NOTHING`，重複上傳是冪等的。回傳 `{id, markdown: "![](images/<id>)"}`。`GET /api/images/{id}` 帶 immutable 快取標頭。

**Taxon 管理**（`taxa.py`）：改名、合併、刪除。改名與合併會把使用該 Taxon 的草稿 revision +1（`_invalidate_drafts`），讓開著的編輯器下次儲存拿到 409，而不是把舊名稱寫回去。合併 Topic 或 Series 會直接 `UPDATE` 草稿與 Published Version 的 `topic_id`／`series_id`（migration 0010 為此放寬 trigger）。合併 Tag 是在兩張關聯表重插再刪除來源。仍被使用（含保留中的版本）的 Taxon 不能刪除，回 409。

**Profile**（`profile.py`）：About 頁與網站標題、描述、footer，存在 `profile` 唯一一列的 JSONB。`PUT /api/profile` 帶 `{revision, content}`，revision 不符回 409。Pydantic 模型 `ProfileContent` 是後端的形狀定義。

### 3.3 從「更新網站」到上線

```mermaid
sequenceDiagram
  actor A as 作者
  participant SPA as CMS releases.tsx
  participant API as release.py / exporter.py
  participant DB as PostgreSQL
  participant Git as 內容 repo clone
  participant GH as GitHub API
  participant WF as deploy.yml
  participant P as GitHub Pages

  A->>SPA: 按「更新網站」
  SPA->>API: POST /api/releases
  API->>DB: pg_try_advisory_lock（拿不到回 409）
  API->>Git: unknown_remote_commit（ls-remote）
  API->>DB: REPEATABLE READ 讀已發布內容
  API->>Git: 寫檔、git commit "Release <ULID>"
  API->>DB: 新增 Release(EXPORTED)，舊的可重試 Release 改 SUPERSEDED
  API->>Git: git push（120 秒逾時）
  API->>DB: PUSHED
  API->>GH: dispatch deploy.yml {content_sha}
  API->>DB: DISPATCHED
  API-->>SPA: {release}
  loop 頁面開著且有 DISPATCHED/BUILDING，每 15 秒
    SPA->>API: POST /api/releases/refresh
    API->>GH: 依 run-name 找 run，查 job 與 step
    API->>DB: 條件式 UPDATE 狀態
  end
  WF->>WF: build：checkout 內容 content_sha、npm run build（驗證 Snapshot）、check-links
  WF->>WF: deploy：ls-remote 內容 HEAD，等於 content_sha 才執行
  WF->>P: Deploy to GitHub Pages
```

**步驟細節**：

1. `create_release` 先用 `_content_repo()` 確認 `CONTENT_REPO_DIR` 是 git clone（否則 503），再呼叫 `release.create`。`deployer_from_env()` 在 `CMS_GITHUB_TOKEN` 與 `DEPLOY_REPO` 都設定時才回傳 `GitHubActions`，否則為 None。這是 sync 路由，push 時可能卡住一個 worker thread 最多 120 秒。
2. `_exclusive()` 用獨立連線取 `pg_try_advisory_lock`，拿不到丟 `ReleaseBusy`（409）。retry 用同一把鎖。
3. `exporter.unknown_remote_commit` 對 upstream `ls-remote`。遠端的 tip 不是本地 HEAD 的祖先，代表別的 CMS 推過內容，丟 `ReleaseError`。git 出錯時放行。
4. 冷卻：距離上一個 Release 不到 30 秒時拒絕。
5. `export`：
   - 在 REPEATABLE READ 交易中 `render_snapshot`：每篇 published 文章取最新版本（`DISTINCT ON`），輸出 `articles/<doc_id>.json`；加上 `profile.json`；`manifest.json` 為 `{schema_version: 1, release_id, created_at, articles: [{doc_id, version}], archived_articles: [{doc_id}]}`。被引用的圖缺檔時丟 `ExportError`。
   - `_discard_interrupted_export` 把四個 Snapshot 路徑還原到 HEAD，清掉上次中斷留下的半成品。
   - `write_snapshot`：若檔案集合與內容只差在 `release_id`／`created_at`，回傳 None（沒有變更）。否則刪掉多餘檔案、寫入新檔，圖片只寫新的（id 是內容雜湊，不必重讀舊檔）。
   - `git add --all` 只對 `SNAPSHOT_PATHS`，`git commit -m "Release <release_id>"`。這一步不 push。
   - export 回傳 None 時，`create` 再用 `head_release` 看 HEAD 是不是一個還沒有 Release 列的 release commit（上次 crash 留下的），有的話接手它。
6. 兩者皆無，或該 Release 已存在：回傳 `{release: null}`，CMS 顯示「已發布的內容沒有變更」。
7. 否則新增 `Release(EXPORTED)` 與 `release_articles`，把較舊、未終結、可重試的 Release 改成 SUPERSEDED，commit，進入 `_advance`。
8. `_advance` 從目前狀態往下推：
   - EXPORTED、PUSH_FAILED：`git push --quiet`（`GIT_TERMINAL_PROMPT=0`）。成功 PUSHED；失敗或逾時 PUSH_FAILED，`detail` 存遮蔽過的 stderr 最後 500 字。
   - PUSHED、DISPATCH_FAILED、FAILED：沒有 deployer 直接 DISPATCH_FAILED。否則 `POST /repos/{DEPLOY_REPO}/actions/workflows/{DEPLOY_WORKFLOW}/dispatches`，`ref` 為 `DEPLOY_REF`，`inputs.content_sha` 為 commit。成功 DISPATCHED，重設 `dispatched_at`，清掉 `run_url`，**刻意保留** `run_id`。

**狀態追蹤**（`refresh_in_flight`，`POST /api/releases/refresh`）：

- 先把 DISPATCHED／BUILDING 的 Release 讀成 frozen `_InFlight` 後 commit，呼叫 GitHub 時不佔用資料庫連線。
- `_check`：BUILDING 且有 `run_id` 直接取 run。否則 `find_run` 列出 `dispatched_at − 5 分鐘` 之後的 `workflow_dispatch` runs，找第一個 `display_title == "Deploy content <sha>"` 且 id 大於已存 `run_id` 的。dispatch 後 30 分鐘還找不到改 FAILED。GitHub 回錯只更新 `detail`。
- `_outcome`：未完成 BUILDING；cancelled 為 SUPERSEDED；其他非 success 為 FAILED；success 但 `Deploy to GitHub Pages` step 被 skip 為 SUPERSEDED；否則 DEPLOYED。
- 寫回用條件式 `UPDATE ... WHERE id = ? AND status = 舊值 AND run_id IS NOT DISTINCT FROM 舊值`，不拿 advisory lock。
- 有 Release 新變成 DEPLOYED 時呼叫 `retention.cleanup_versions`。

```mermaid
stateDiagram-v2
  [*] --> exported: 匯出並 commit
  exported --> pushed: push 成功
  exported --> push_failed: push 失敗或逾時
  push_failed --> pushed: 重試
  pushed --> dispatched: dispatch 成功
  pushed --> dispatch_failed: 沒有 token 或 API 錯誤
  dispatch_failed --> dispatched: 重試
  dispatched --> building: 找到 run，尚未完成
  dispatched --> deployed: 第一次看到就已成功
  dispatched --> failed: 30 分鐘找不到 run
  building --> deployed: 成功且部署 step 有執行
  building --> superseded: run 被取消，或部署 step 被 skip
  building --> failed: run 失敗
  failed --> dispatched: 重試（重新 dispatch 同一 commit）
  exported --> superseded: 有更新的 Release 建立
  push_failed --> superseded: 有更新的 Release 建立
  pushed --> superseded: 有更新的 Release 建立
  dispatch_failed --> superseded: 有更新的 Release 建立
  deployed --> [*]
  superseded --> [*]
```

`dispatched` 第一次被看到時也可能直接是 superseded 或 failed，圖中省略。

**重試與取代規則**（`release.py`）：

- `TERMINAL = {deployed, superseded, failed}`。`RETRYABLE = {exported, push_failed, pushed, dispatch_failed, failed}`。failed 對取代邏輯而言是終結，但仍可重試。
- `POST /api/releases/{id}/retry` 只接受 RETRYABLE 而且是**最新**（id 最大）的 Release。從失敗的那一步繼續。重試不做 remote 檢查也不受冷卻限制。
- 建立新 Release 時，較舊的 exported／push_failed／pushed／dispatch_failed 直接改 superseded。較舊的 dispatched／building 不動，留給 refresh 從 GitHub 判斷。
- `deploy.yml` 的 build job 用 `pages-build`、deploy job 用 `pages-deploy` 兩個 concurrency group，`cancel-in-progress: false`：同時只跑一個 build 與一個 deploy，新的 pending job 取消舊的 pending job，整個 run 因此是 cancelled（CMS 記為 superseded）。concurrency 設在 job 而不是整個 run，所以跳過 build 的 push run 不會取消排隊中的內容發布。
- deploy job 在部署前 `ls-remote` 內容 repo HEAD。HEAD 已經不是這次建置的 commit 就 skip `Deploy to GitHub Pages`（CMS 記為 superseded）。所以只有最新的內容會上線。
- FAILED 重試會 dispatch 同一個 commit。保留的 `run_id` 當作「跳過 id 不大於它的 run」，避免又認到舊的失敗 run。

**當機安全**有三處：export 後、建立 Release 列前當掉，下次 `head_release` 接手那個 commit；寫檔途中當掉，`_discard_interrupted_export` 清掉；push 或 dispatch 中斷，狀態停在可重試或被下一個 Release 取代，下一次 push 會一起帶上之前的 commit。

### 3.4 公開網站如何建置

`frontend/` 是 Next.js 16，`output: "export"`、`trailingSlash: true`，所有路由 force-static，`dynamicParams = false`。建置時從 `SITE_DATA_DIR`（預設 `sample-site-data`）讀一份 Snapshot，輸出到 `frontend/out/`。執行期只有瀏覽器端程式：搜尋、主題、目錄、複製與放大、giscus、404 的最新文章清單。

**建置流程**：

1. `scripts/copy-snapshot-images.ts`（`npm run build`／`dev` 之前）：刪除並重建 `public/images`、`public/thumbs`，用 sharp 產生 320 px 寬的 WebP 縮圖。
2. `content/load.ts` 的 `loadSiteContent()` 讀檔並快取，交給 `content/parse.ts` 的 `parseSnapshot()`。
3. `parseSnapshot` 是 Snapshot 格式的權威與驗證器：`schema_version` 必須是 1；`doc_id` 必須是大寫 ULID；每篇的 `doc_id`／`version` 必須與 manifest 一致；引用的圖必須存在；`blockedUrls` 必須為空；cover 必須在自己的引用中；`doc_id` 不能重複；沒有 `profile.json` 時用 `DEFAULT_PROFILE`。任何錯誤丟 `ContentError`，建置失敗，什麼都不會部署。
4. 產生 static params，server render 每一頁。
5. route handler 產生 `feed.xml`、`sitemap.xml`、`latest-posts.json`、`search-metadata.json`、`search-data/<YYYY-hash>/chunk.json`，以及 `404.html`。

`content/model.ts` 定義網站看到的模型：`PublishedArticle`（`state: "published"`）與 `ArchivedArticle`（只有 `docId`）。草稿與待刪除文章不會出現在 Snapshot。

**路由**（`src/app/`）：

| 路徑 | 內容 |
|---|---|
| `/` | 置頂文章，然後 5 篇最新的非置頂文章 |
| `/posts/`、`/posts/page/<n>/` | 文章列表，每頁 10 篇，第 1 頁是 `/posts/` |
| `/posts/<docId>/` | 文章頁。封存文章也會產生，顯示「文章已封存」並 `noindex` |
| `/topics/`、`/topics/<slug>/`、`/tags/`、`/tags/<slug>/` | Taxon 索引與列表（只算已發布文章） |
| `/archive/` | 依台北時間分年，兩種排序都在 server 端 render |
| `/about/` | Profile |
| `/search/` | 搜尋頁，`?q=` 同步 |
| `/feed.xml`、`/sitemap.xml`、`/latest-posts.json` | RSS 2.0 最新 20 篇、sitemap、404 頁用的清單 |

文章頁包含 metadata（canonical、OG、Twitter）、閱讀進度、系列導覽、目錄、內文、相關文章（同 Topic 權重 2，每個共同 Tag +1，取 3 篇）、上一篇／下一篇、giscus 留言。封存文章不出現在列表、sitemap、feed 與搜尋中。沒有任何文章時，`static-params.ts` 回傳 `"_"` 佔位，CI 也會用 `test-fixtures/empty-site-data` 建置一次確認空站可以建。

**Markdown 渲染**（`content/markdown.ts` 的 `renderMarkdown`）：Marked 加 Shiki（21 種語言，雙主題，模組頂層 await）。原始 HTML 一律跳脫；不允許的連結變純文字，不允許的圖片 src 為空；外部連結加 `target="_blank" rel="noopener noreferrer"`；段落中只有一張有 alt 的圖時輸出 `figure`；`images/` 改寫成 `${basePath}/images/`；h2／h3 的 id 來自 `headings.ts` 的 `slugger()`（保留中日韓字元，重複加 `-2`），目錄用同一套規則。網址政策在 `content/url-policy.ts`。

**搜尋**：`content/search.ts` 的 `buildIndex` 由 server 與瀏覽器共用。內文取摘要加純文字最多 5000 個 UTF-16 單位，切詞後去重，所以沒有詞頻排序。權重：標題 10、Topic／Tag 5、內文 1，同分較新的優先。`search-assets.ts` 把它拆成 `search-metadata.json`（`version: 1`，每篇 metadata 與內文前 160 字）與依台北年份切的內文 chunk（檔名含內容雜湊，可長期快取）。

瀏覽器端（`app/search/load-index.ts`）是一個 `useSyncExternalStore` store：先以 `no-store` 抓 metadata 並檢查 version，接著從最新年份開始逐年抓 chunk，每年抓完就更新結果。某年失敗時保留已載入的文章，`retry` 從失敗的年份繼續。header 的搜尋框 focus 時才開始載入。

**其他執行期**：`theme.ts`（system／light／dark 存在 localStorage，`<head>` 內嵌 script 避免閃爍，切換時通知 giscus iframe）；`comments.tsx`（`GISCUS_*` 兩個 id 都有才 render，以 `docId` 對應 discussion）。`src/site.ts` 給 client component 用，不能 import `load.ts` 或 `node:` 模組。

`next.config.ts`：`basePath = BASE_PATH ?? "/personal-blog"`，`SITE_ORIGIN` 預設 `https://example.com`。部署時由 `actions/configure-pages` 提供真正的 origin 與 base path。

### 3.5 CMS 前端

`cms/` 是 Vite + React 的 SPA，`base: "/admin/"`。`npm run build` 為 `tsc --noEmit && vite build`，輸出 `cms/dist`（gitignored），由後端在 `/admin` 提供。`npm run dev` 把 `/api` 代理到 `127.0.0.1:8000`。CMS 不部署到任何地方，只在作者電腦上跑。

`main.tsx` 是 hash router 與登入閘門。`api.ts` 是唯一的 fetch 包裝：同源 `/api${path}`，非 2xx 丟 `ApiError(status, body)`；非 `/session` 的 401 會發出 `cms:signed-out` 事件。wire type 是手寫鏡像，沒有 OpenAPI codegen。

| 畫面（hash） | 呼叫的 endpoint |
|---|---|
| 啟動 | `GET /api/session` |
| 登入覆蓋層 | `POST /api/session` |
| 文章列表 `#/` | `GET /api/articles`（「待刪除」分頁加 `?state=pending_deletion`）、`PUT .../pinned`、`POST .../archive`、`DELETE /api/articles/{id}`、`POST .../restore`、`POST .../purge`、`DELETE /api/session`、`DELETE /api/sessions` |
| 新文章 `#/new` | `POST /api/articles`，成功後 `location.replace('#/edit/<doc_id>')` |
| 編輯器 `#/edit/<doc_id>` | `GET .../draft`、`PUT .../draft`、`POST .../publish`、`POST /api/images`、`GET /api/images/{id}` |
| 快照面板 | `GET .../snapshots`、`POST .../snapshots/{id}/restore` |
| 分類 `#/taxa` | `GET /api/taxa`、`PUT /api/taxa/{kind}/{slug}`、`POST .../merge`、`DELETE ...` |
| 個人資料 `#/profile` | `GET /api/profile`、`PUT /api/profile` |
| 網站發布 `#/releases` | `POST /api/releases/refresh`、`GET /api/github-token`、`GET /api/github-status`、`POST /api/releases`、`POST /api/releases/{id}/retry` |

`GET /api/articles` 不帶 `state` 時回傳所有狀態，「文章」分頁在前端濾掉 pending_deletion。`GET /api/releases` 與 `/healthz` CMS 沒有用到。

**DraftSync**（`draft-sync.ts`）是編輯器的核心：

- 一條 promise 佇列序列化 save、publish、restore，每個操作帶上前一個操作得到的 revision。
- 輸入後 debounce 1 秒才送出。Topic 不合法時不自動儲存（狀態顯示未儲存原因）；不合法的 tag 與 series 會被默默略過。
- 網路錯誤與 5xx 以 2 秒起、最多 60 秒的指數退避重試。
- 409 且帶 `current_revision`：進入 conflict 狀態，停止儲存，顯示橫幅（複製 Markdown、捨棄並重新載入）。分類改名或合併也會觸發這個情況。
- 401：等使用者重新登入（`SIGNED_IN` 事件）後 `flush()`。登入覆蓋層蓋在 `inert` 的頁面上，不會卸載編輯器，所以內容不會遺失。
- 其他 4xx：停止。
- `close()`：最後一次 flush 並停止重試。編輯器以 `key = doc_id@revision` 掛載，重新載入時舊的 DraftSync 不會繼續送出舊內容。

**發布按鈕**：`publish-checks.ts` 的警告（沒有 tag、圖片缺 alt、標題超過 60 字、`http://` 連結、原始 HTML、TODO、cover 不在文中）只要求確認，不擋發布。`urlProblems` 有問題時停用按鈕。發布走同一個 DraftSync 佇列，成功顯示「已發布第 N 版」並提醒到「網站發布」頁更新網站。

**預覽**（`preview.ts`）是 `frontend/src/content/markdown.ts` 的手寫鏡像：同樣 21 種語言（Shiki 依語言延遲載入）、figure、外部連結標記、跳脫原始 HTML。`images/<id>` 只在輸出的 HTML 中改寫成 `/api/images/<id>`。

**離開保護**（`leave-guard.ts`）：`beforeunload` 加上 router 自己的 `confirm()`（hash 變更不觸發 `beforeunload`，取消時以 `history.replaceState` 還原）。

**網站發布頁**（`releases.tsx`）：列表一律透過 `POST /api/releases/refresh` 取得，所以每次開頁都會問 GitHub。有 dispatched／building 時每 15 秒輪詢一次。只有第一列且狀態可重試時顯示「重試」。`token-warning.ts` 在 `CMS_GITHUB_TOKEN` 快到期時警告。部署從最近一次 dispatch 起等待超過 10 分鐘時（`deploy-delay.ts`），頁面另外呼叫 `GET /api/github-status`，由後端代查 githubstatus.com 上影響 Actions 或 Pages 的事故並顯示（PUB-009）。

### 3.6 背景維護、備份與資料保留

沒有常駐的排程器。`backend/scripts/start.sh` 每次啟動依序執行：

1. 檢查 `.env`；8000 埠上已有 CMS（`blog.api:app`）時先停掉它，被其他程式佔用時中止（`lib.sh` 的 `stop_cms`）；`docker compose up -d --wait`（Postgres 16，只綁 `127.0.0.1:5432`）。
2. `backup.sh`。備份失敗**而且**有待執行的 migration 時中止。
3. `alembic upgrade head`。
4. `python -m blog.maintenance`。
5. `uvicorn` 監聽 `127.0.0.1:8000`。預設由 `lib.sh` 的 `start_detached` 在背景執行，輸出寫到 `backend/logs/cms.log`，等 `/healthz` 回應後腳本才結束；`--log` 改為前景執行。`scripts/stop.sh` 用同一個 `stop_cms` 關閉。

直接執行 `uvicorn` 不會跑維護。雲端的建議做法是 cron 每小時執行 `python -m blog.maintenance`（`local-setup.md` 第 13 節）。

`maintenance.run()` 用 `pg_try_advisory_lock`，拿不到就跳過。依序執行：

- **`articles.purge_expired`**：待刪除滿 30 天的文章永久刪除（`FOR UPDATE SKIP LOCKED`）。
- **`retention.cleanup_versions`**：還沒有任何 DEPLOYED Release 時不做事。受保護的版本是最新一個 DEPLOYED Release 與所有 exported／pushed／dispatched／building Release 中的版本。一個版本在以下條件都成立時才刪除：在該文章中排名第 4 以後（`KEEP_LATEST = 3`）、文章不是 pending_deletion、有一個較新版本的 `published_at` 不晚於上線 Release 的 `created_at`、不在受保護集合中。
- **`images.collect_garbage`**：以 `LOCK TABLE ... IN SHARE MODE` 鎖住草稿、快照、版本、profile，解析所有 Markdown（含 profile 的 intro），設定或清除 `unreferenced_since`，刪除未被引用滿 7 天的圖。從未被引用的上傳也會在 7 天後刪除。

**備份與還原**：`backup.sh` 以 `pg_dump -Fc` 輸出並附 `.sha256`，目標可以是資料夾或 `s3://`。`restore.sh` 會 `DROP SCHEMA public CASCADE`、`pg_restore`，再 `alembic upgrade head`。`lib.sh` 以 `PGPASSWORD` 傳密碼，不放在 argv。圖片在 Postgres 裡，所以一份 `pg_dump` 涵蓋內容 repo 以外的所有資料。

### 3.7 CI 與部署 workflow

| Workflow | 觸發 | 內容 |
|---|---|---|
| `ci.yml` | pull_request、`workflow_call`（push 到 main 時由 `deploy.yml` 呼叫） | **frontend**：單元測試、typecheck、build、`verify-site.sh`、`check-links`、Playwright、空 Snapshot build。**cms**：測試、build。**backend**：Postgres 16 service、`ruff check`、`ruff format --check`、pytest（也安裝 frontend，因為 `test_exporter` 用前端 parser 驗證匯出結果） |
| `deploy.yml` | push 到 main、`workflow_dispatch`（`content_sha`） | **ci**：只在 push 時呼叫 `ci.yml`。**site-changes**：只在 push 時執行，比對 `github.event.before` 與這次 commit，有改到 `frontend/`、`.nvmrc` 或 `deploy.yml` 才輸出 `changed=true`；找不到前一個 commit 時也視為有改。**build**：push 時只在 site-changes 不是 `false` 時執行，`workflow_dispatch` 一律執行；checkout 程式於觸發的 ref、checkout 內容 repo 於 `content_sha`（沒給就用 HEAD）到 `site-data`、`configure-pages`、`npm ci && npm run build`、`check-links.ts`、上傳 `frontend/out`。**deploy**：build 成功且 ci 成功或被 skip 時執行；`ls-remote` 內容 HEAD，等於建置的 commit 才執行 `Deploy to GitHub Pages` |
| `token-expiry.yml` | 每週一 01:00 UTC | 讀 `CONTENT_REPO_TOKEN` 的 `github-authentication-token-expiration` header，30 天內到期或請求失敗時開 issue（已有未關閉的就不重開） |
| `cms-image.yml` | 獨立 | 建 Docker image、跑 migration、測 backup／restore、探測 `/healthz` |

`deploy.yml` 的 `run-name` 是 `Deploy content ${{ inputs.content_sha || 'HEAD' }}`。CMS 靠這個標題找 run，靠 step 名稱 `Deploy to GitHub Pages` 判斷是否真的部署。只有 deploy job 有 `pages: write` 與 `id-token: write`。內容 repo 由 `vars.CONTENT_REPO` 指定，預設 `<本 repo>-content`。

合併到 main 就會部署：程式變更走 push 觸發，先跑完整 CI。CMS 的內容發布走 `workflow_dispatch`，不跑 CI，但 build 本身會驗證 Snapshot。

Dependabot 每週檢查 `/frontend`、`/cms` 的 npm（minor 與 patch 合併成一組）、`/backend` 的 uv、以及 Actions。

## 4. 程式碼位置

```
backend/
  blog/
    api.py          FastAPI app、middleware、所有路由、例外對應、/admin 掛載
    config.py       Settings 與環境變數
    db.py           engine、SessionLocal、SessionDep
    models.py       所有 SQLAlchemy 模型與 enum
    articles.py     文章狀態機、自動儲存、發布、快照、刪除與還原
    taxa.py         Topic/Tag/Series 的用量、改名、合併、刪除
    images.py       上傳轉檔、引用解析、垃圾回收
    profile.py      ProfileContent 與 revision 檢查
    auth.py         密碼、登入節流、session；CLI 設定密碼
    exporter.py     render_snapshot、寫入 clone、commit、push、remote 檢查；CLI
    release.py      Release 狀態機、GitHubActions REST client、refresh
    retention.py    Published Version 清理
    maintenance.py  到期工作的入口
  migrations/versions/  Alembic 0001..0012（含 trigger 與 CHECK）
  scripts/          start.sh、stop.sh、backup.sh、restore.sh、lib.sh
  tests/            每個模組一個測試檔，conftest.py 需要 TEST_DATABASE_URL
  compose.yaml      本機 Postgres 16
cms/src/
  main.tsx          hash router、登入閘門
  api.ts            fetch 包裝與 wire type
  draft-sync.ts     自動儲存佇列
  editor.tsx        編輯器；preview.ts、publish-checks.ts、cover.ts、snapshot-panel.tsx
  article-list.tsx、taxa-page.tsx、profile-page.tsx、releases.tsx
  url-policy.ts     frontend 的逐字複本
frontend/
  next.config.ts    basePath、SITE_ORIGIN、GISCUS_*
  src/content/      parse.ts（Snapshot 契約）、model.ts、load.ts、queries.ts、markdown.ts、
                    url-policy.ts、headings.ts、search.ts、search-assets.ts、feed.ts、sitemap.ts
  src/app/          路由與 client component
  scripts/          copy-snapshot-images.ts、check-snapshot.ts、check-links.ts、verify-site.sh
  sample-site-data/ 本機與 CI 用的範例 Snapshot（3 篇已發布、1 篇封存、2 張圖）
  test-fixtures/    跨專案共用的測試資料
  e2e/              Playwright
.github/workflows/  ci.yml、deploy.yml、token-expiry.yml、cms-image.yml
Dockerfile          CMS image（尚不能「更新網站」）
```

### 新功能該放哪裡

**新增文章欄位**（例如副標題）要跨三個專案一起改：

1. `backend/blog/models.py`：`WorkingDraft` 與 `PublishedVersion` 加欄位。
2. `backend/migrations/versions/`：新 migration。注意 `published_versions` 的 UPDATE trigger。
3. `backend/blog/articles.py`：`DraftContent`、`_apply`、發布時複製到版本。
4. `backend/blog/api.py`：`DraftBody`、`DraftOut`。
5. `backend/blog/exporter.py` 的 `render_snapshot`：寫入 `articles/<doc_id>.json`。
6. `frontend/src/content/parse.ts`（`parseArticleFile`）與 `model.ts`，再到用到的頁面。選填欄位不必升 `SCHEMA_VERSION`；改變既有欄位意義時才升，而且 backend 的 `schema_version` 要一起改。
7. `cms/src/api.ts` 的型別與 `editor.tsx`。
8. 測試：`backend/tests/test_exporter.py`（會用 `frontend/scripts/check-snapshot.ts` 驗證）、`frontend/sample-site-data/`、`frontend/src/content/content.test.ts`。

**新增 Profile 欄位**：`backend/blog/profile.py` 的 `ProfileContent`、`frontend/src/content/parse.ts` 的 `parseProfile` 與 `DEFAULT_PROFILE`（兩邊的預設值互為鏡像）、`cms/src/profile-form.ts` 與 `profile-page.tsx`。

**改 Markdown 渲染或網址政策**：同時改 `frontend/src/content/markdown.ts` 與 `cms/src/preview.ts`；網址政策改 `frontend/src/content/url-policy.ts` 後複製到 `cms/src/url-policy.ts` 與 `backend/blog/url_policy.py`，並更新 `frontend/test-fixtures/url-policy.json`。圖片引用規則改了要同步 `backend/blog/images.py` 的 `refs`、`frontend/src/content/parse.ts` 的 `imagePaths`、`cms/src/cover.ts`，共用 fixture 是 `frontend/test-fixtures/image-refs.json`。

**新的後台操作**：領域邏輯放在對應的 `backend/blog/<module>.py`，用 `_locked` 與 `ALLOWED_FROM` 表達狀態規則；例外在 `api.py` 對應成 HTTP；路由不需要另外處理驗證。CMS 端在 `api.ts` 加方法，畫面放在對應的 `*-page.tsx`。

**新的公開頁面**：`frontend/src/app/` 下新增路由，資料從 `loadSiteContent()` 與 `queries.ts` 取得。有固定 id 的頁面元素要加進 `headings.ts` 的保留 id。`verify-site.sh` 與 e2e 以範例資料寫死斷言，需要時一起更新。

**新的定期工作**：加進 `maintenance.run()`，不要另外起排程。

**Release 狀態變更**：`models.py` 的 `ReleaseStatus`、`release.py` 的 `TERMINAL`／`RETRYABLE`、`retention.py` 的 `_PENDING`、`cms/src/releases.tsx` 的 `RETRYABLE`／`PENDING` 與 `labels.ts`。

## 5. 容易出錯的地方

依影響程度排序。

1. **「發布」不會更新網站。** 作者與開發者都容易誤會。只有「更新網站」會匯出與部署，而且一次匯出全部已發布內容。
2. **`deploy.yml` 的 `run-name` 與 step 名稱 `Deploy to GitHub Pages` 是 CMS 的介面。** 改名會讓 CMS 找不到 run（30 分鐘後 FAILED）或把每次部署都記成 superseded。`deploy.yml` 與 `release.py` 的註解互相指向。
3. **程式碼 push 到 main 也會跑 `deploy.yml`**（標題為 `Deploy content HEAD`）。有改到 `frontend/`、`.nvmrc` 或 `deploy.yml` 時才會 build，並和 CMS 的 run 共用 `pages-build`／`pages-deploy` concurrency group。它可能取消一個排隊中的 CMS run，CMS 顯示 superseded，但內容其實隨那次 push 的 run（建置內容 HEAD）上線。只改文件、後端或 CMS 的 push 只跑 ci，網站不會重新部署。
4. **Snapshot 契約跨三個專案。** 匯出由 `exporter.render_snapshot` 寫，網站由 `parse.ts` 讀，後端測試用 `check-snapshot.ts` 當契約測試。改欄位要三邊一起改（見第 4 節）。
5. **手寫鏡像要一起改**：
   - `cms/src/preview.ts` 對 `frontend/src/content/markdown.ts`（沒有測試確認兩者輸出相同）。
   - `cms/src/url-policy.ts` 對 `frontend/src/content/url-policy.ts`（有逐字相等的測試）。
   - 圖片引用：`images.refs`、`imagePaths`、`cover.ts`，共用 `image-refs.json`。
   - `DEFAULT_PROFILE`／`DEFAULT_SITE`：`parse.ts` 對 `profile.py`。
   - Release 狀態清單：`release.py` 對 `releases.tsx`。
   - `cms/src/api.ts` 的 wire type 對 `api.py` 的 Pydantic 模型。
   - `marked` 與 `shiki` 版本：`cms` 與 `frontend` 必須相同（`shared-deps.test.ts`）。Dependabot 的 major bump 要合成一個 PR。
   - 登入錯誤訊息：CMS 用正規表示式 `in (\d+) seconds` 解析 `TooManyAttempts` 的文字，改措辭會壞掉倒數。
6. **Taxon 名稱是全域、最後寫入者勝。** Published Version 指向 Taxon 列，所以改名會改到已上線文章下次匯出的名稱。這也是改名與合併要讓草稿 revision +1 的原因。
7. **Published Version 不是完全不可變。** 合併 Taxon 時會 UPDATE `topic_id`／`series_id`，資料保留會 DELETE 舊版本。
8. **沒有變更時要按「重試」。** 「沒有變更」的判斷忽略 `release_id`，所以 FAILED 之後若沒有新內容，「更新網站」只會說沒有變更，必須按最新那一列的「重試」。
9. **狀態只在頁面開著時更新。** refresh 是拉取式，沒有人開「網站發布」頁就沒有人問 GitHub，DEPLOYED 也就不會被記錄，版本清理不會進行。
10. **remote 檢查只在建立時做，而且失敗時放行。** 另一台電腦推過內容時會擋下（訊息指向 `local-setup.md` 第 12 節）；解法是在 clone 裡 `git pull`（第 14 節）。CMS 從不 fetch 或 pull。
11. **`/admin` 只在 import 時掛載。** 第一次 `npm run build` 之後要重啟後端。
12. **設定與 engine 在 import 時讀取。** 測試的 `conftest.py` 先把 `TEST_DATABASE_URL` 複製到 `DATABASE_URL` 才 import `blog`。程式在呼叫時讀 `config.settings.X`，所以 monkeypatch 有效。
13. **測試是破壞性的。** `conftest.py` 會對 `TEST_DATABASE_URL` 做 `alembic downgrade base` 再 upgrade，每個測試後 truncate。不要指向真正的資料庫。
14. **反向代理之後**：要設定 `CMS_ORIGIN`（否則 Origin 檢查用到 http://），登入節流依 `request.client.host`，需要 uvicorn 的 `FORWARDED_ALLOW_IPS` 才會是真實 IP。
15. **CSRF 依賴 `SameSite=Strict` 加 Origin 檢查。** 沒帶 `Origin` 的請求會通過 Origin 檢查。
16. **編輯器靜默行為**：Topic 不合法時完全不自動儲存；不合法的 tag／series 會被丟掉後才送出。
17. **兩種 409**：`RevisionConflict`（有 `current_revision`，進入衝突橫幅）與 `InvalidTransition`（有 `state`，顯示一般錯誤且不重試）。
18. **`first_published_at` 在第一次發布時固定。** migration 0007 回填的值可能比實際發布時間晚。
19. **網站的測試綁定範例資料。** `verify-site.sh` 與 e2e 寫死 sample 的 `doc_id`、`/personal-blog` 與 `https://example.com`。CI 用假的 `GISCUS_*` 建置。
20. **目錄 id 依賴兩條程式路徑同步。** `renderMarkdown` 與 `tocHeadings` 都用 `slugger()`，順序必須一致；頁面上固定的 id（`toc`、`related-title`）要列在 `headings.ts` 的保留清單。
21. **時區**：顯示日期、彙整分年、搜尋 chunk 分年都用 `Asia/Taipei`。
22. **一次 Release 可能佔用三條資料庫連線**（advisory lock、REPEATABLE READ 匯出、ORM session）。`export` 內 `git commit` 失敗會回 500 而不是 409，下一次會重做。
23. **Docker image 還不能「更新網站」。** image 裡沒有內容 repo clone、git 身分與 push 認證。
24. **Token 到期**：`CONTENT_REPO_TOKEN` 約 2027-01-18 到期，由 `token-expiry.yml` 開 issue 提醒；`CMS_GITHUB_TOKEN` 由 CMS 網站發布頁提醒。新 fork 第一次部署要手動執行 `Deploy site`，內容 repo 以 `test-fixtures/empty-site-data/manifest.json` 起始（見 `fork-and-deploy.md`）。

## 6. 尚未確認

- **內容 repo 的分支**：clone push 到其 upstream 分支，而 `deploy.yml` 的 `ls-remote ... HEAD` 與「沒給 `content_sha` 時 checkout 預設分支」都假設那就是內容 repo 的預設分支。程式沒有檢查兩者一致。
- **雲端 CMS 如何 push 與發布**：`docs/backlog.md` 中「發布方式」與「GitHub 憑證」仍待決定。在那之前 Docker image 只能編輯，不能更新網站。
- **雲端維護排程**：文件建議 cron，但 repo 裡沒有對應的 unit 或排程設定。
- **`test_scripts.py` 的涵蓋範圍**：本次沒有細讀。

已確認的事項（不再列為未確認）：

- 後端 `articles.publish` 檢查標題、Markdown、cover、圖片存在與網址政策。
- `GET /api/articles` 不帶 `state` 回傳所有狀態。
- `retention` 的受保護集合不含 push_failed、dispatch_failed、failed。這是安全的：重試這些狀態時推送或 dispatch 的是已經存在的 commit，不會從資料庫重新匯出，刪掉資料庫裡的舊版本不影響它們。
