# Personal Blog — Addendum 03：Backend Foundation

> **這是設計紀錄，不是教學。** 記錄需求與架構決策及其理由；實際行為以程式碼為準。要建立自己的部落格請看 [`fork-and-deploy.md`](../fork-and-deploy.md)。

> **基線**：[Baseline v1.0](./personal-blog-system-spec-baseline-v1.0.md)，[Addendum 01](./personal-blog-system-spec-addendum-01-domain-model.md)，[Addendum 02](./personal-blog-system-spec-addendum-02-publishing-pipeline.md)
> **日期**：2026-10-20 起
> **Status 說明**：標為 Accepted (delegated) 的決策，由作者授權採用設計建議，作者可隨時推翻。

## Decisions

### BE-001：後端技術組合

- **Status**：Accepted (delegated)
- **Context**：Baseline 2.3 只定了 FastAPI 與 PostgreSQL，ORM、遷移工具與套件管理另行決定。
- **Decision**：Python 3.12+、FastAPI、SQLAlchemy 2（ORM）、Alembic（schema migration）、psycopg 3、python-ulid、pytest + HTTPX（測試）、uv（套件與虛擬環境管理）。本機 PostgreSQL 16 以 `backend/compose.yaml` 執行，雲端主機以容器執行（BE-027）。
- **Consequences**：測試直接使用真實 PostgreSQL（列鎖、trigger 等行為無法用 SQLite 取代）。CI 以 PostgreSQL service container 執行。

### BE-002：ART-020／ART-021 的資料表與 API 形狀

- **Status**：Accepted (delegated)
- **Decision**：
  - 資料表：`articles`（內部 PK + 唯一 `doc_id`，CHECK 為大寫 ULID）、`working_drafts`（以 `article_id` 為 PK，一篇一份）、`published_versions`（`UNIQUE(article_id, version)`）、`topics`、`tags`、`working_draft_tags`、`published_version_tags`。
  - `published_versions` 與 `published_version_tags` 由 trigger 拒絕 `UPDATE`；`DELETE` 保留給版本清理（Baseline 6.3）。
  - Auto Save 與 Publish 都帶 `base_revision`；不符時回 409 與 `current_revision`。
  - Publish 請求帶入作者畫面上的完整內容；後端在同一交易中鎖定 draft 列、寫入內容、revision +1、建立下一個版本號。這是 ART-021 第 3 點中「寫入使用者按下 Publish 當下的內容」的選項。
  - Publish 要求 Title 與 Markdown 非空白。

### BE-003：Topic／Tag 以 slug 自動建立

- **Status**：Accepted (delegated)
- **Decision**：Draft 請求以 `{slug, name}` 指定 Topic／Tags；slug 不存在時自動建立。slug 已存在時的名稱規則見 BE-013。
- **Consequences**：改名、合併、刪除由「分類管理」頁處理（BE-019）。

### BE-004：Content Exporter 的匯出規則

- **Status**：Accepted (delegated)
- **Decision**：
  - 每篇有 Published Version 的文章匯出其最新版本；`published_at` 為該文章第一次發布的時間（Baseline 3.1 的「發表日期」），存在 `articles.first_published_at`（BE-015）。
  - 從未發布的文章與所有 Working Draft 內容都不匯出。
  - 先在記憶體中產生完整 Snapshot，再寫入內容 repo；若與目前內容相比只有 `release_id`／`created_at` 不同，則不寫入也不 commit。
  - 只寫入 Snapshot 路徑 `manifest.json`、`profile.json`、`articles/`、`images/`；內容 repo 中的其他檔案不受影響。
  - 寫入方式有兩種：本機 clone 的 git commit 與 push，或 Git Data API（BE-022）。
  - 前後端各自解析 Snapshot；後端測試以前端 parser（`frontend/scripts/check-snapshot.ts`）驗證匯出結果，作為兩邊的契約測試。

### BE-005：Article Lifecycle 狀態機

- **Status**：Accepted (delegated)
- **Context**：Baseline 7.1–7.4。
- **Decision**：
  - `articles.state` 為 `draft`、`published`、`archived`、`pending_deletion` 之一；Permanently Deleted 以刪除資料列並把 `doc_id` 記入 `retired_doc_ids` 表示。
  - 允許的轉換以一張表定義（`blog/articles.py` 的 `ALLOWED_FROM`）：
    - Edit（Auto Save）與 Publish：draft、published、archived。Publish archived 文章即為 Republish，沿用 `doc_id` 並建立新版本。
    - Archive：只限 published。
    - Delete：draft、published、archived → pending_deletion，記錄 `deleted_at` 與 `state_before_deletion`。
    - Restore：pending_deletion → 刪除前的狀態。
    - Purge：只限 pending_deletion。
  - 其他轉換回 409。所有寫入先鎖定 article 列，序列化同一篇文章的變更。
  - 資料庫 CHECK：`pending_deletion` 狀態若且唯若 `deleted_at` 與 `state_before_deletion` 皆非空。
  - 建立文章時產生的 ULID 若已在 `retired_doc_ids` 中則重新產生。
  - 待刪除滿 30 天的文章由 `python -m blog.maintenance` 清除（PUB-005）；可重複執行。
  - Exporter 只匯出 published 的最新版本；archived 只列入 `archived_articles`；draft 與 pending_deletion 都不匯出。
- **Consequences**：Purge 只刪除資料庫資料；已部署的靜態網站在下一次部署前仍顯示舊內容（Baseline 7.1 的最終一致性）。Purge 與圖片 GC 的協調見 BE-007。

### BE-006：CMS 編輯器前端

- **Status**：Accepted (delegated)
- **Context**：Baseline 5.1（HackMD 式分割編輯、Auto Save）。
- **Decision**：
  - CMS 介面為獨立的 `cms/`（Vite + React + TypeScript），build 後由 FastAPI 在 `/admin/` 提供，與 API 同源。公開網站（`frontend/`）不包含任何 CMS 程式碼。
  - Markdown 預覽使用與公開網站相同的 `marked` 版本。
  - Auto Save 停止輸入 1 秒後送出；所有 Auto Save 與 Publish 請求經由同一個佇列依序送出（`cms/src/draft-sync.ts`），每個請求都帶上前一個回應的 revision。Publish 會等進行中的存檔完成，再送出作者目前看到的內容。
  - 收到 409 時停止自動儲存並顯示「重新載入」；不自動合併。
  - 新增文章時先填 Topic（Baseline 4.2）。Tags 以 `slug:名稱` 逗號分隔輸入。
- **Consequences**：同源讓登入可以直接用 cookie session（BE-009）或 Cloudflare Access（BE-026），不需處理 CORS。

### BE-007：圖片上傳、匯出與 GC

- **Status**：Accepted (delegated)
- **Context**：Baseline 5.2、8.1–8.3；PUB-003、PUB-005。
- **Decision**：
  - 只能從編輯器上傳（選擇檔案、貼上、拖曳）。接受 PNG、JPEG、GIF、WebP，最大 10 MB；格式由檔案內容判斷。不接受 SVG。上傳時縮圖並轉成 WebP（BE-014）。
  - 圖片 id 是內容的 SHA-256 加副檔名；相同內容重複上傳得到相同 id。`images`（索引）與 `image_data`（BYTEA）分開，`image_data` 由 trigger 拒絕 `UPDATE`。
  - Markdown 以 `images/<id>` 引用，與 Snapshot 路徑相同；編輯器預覽由 `/api/images/<id>` 載入。
  - 引用是 Markdown parser 找出的圖片 token（行內或參考式），且 href 以 `images/` 開頭。code span、code block 內的文字、一般連結與 HTML `<img>` 都不算引用。後端（GC、Exporter）與前端（Snapshot 檢查）以同一份測試資料 `frontend/test-fixtures/image-refs.json` 確保規則一致。
  - `images.unreferenced_since`：上傳時為上傳時間；草稿每次寫入時，被引用的圖片設為 NULL；GC 時不再被引用者記下開始時間。距今滿 7 天才刪除。
  - 有效引用：所有 Working Draft、Draft Snapshot（BE-008）、保留中的 Published Version（BE-011）與關於頁的自我介紹（BE-017）。待刪除文章的草稿與版本仍在，因此圖片在 30 天內受保護。
  - GC 在交易中以 SHARE 鎖鎖住 `working_drafts`、`draft_snapshots`、`published_versions` 與 `profile`，掃描與刪除之間無法新增引用。
  - GC 由 `python -m blog.maintenance` 執行（PUB-005）；可重複執行。
  - Exporter 只匯出已匯出文章所引用的圖片；引用的圖片不存在時整次匯出失敗、不寫入。
- **Consequences**：已部署網站的圖片存在內容 repo 中，不依賴資料庫，所以 GC 不會破壞線上網站。

### BE-008：Draft Snapshots

- **Status**：Accepted (delegated)
- **Context**：Baseline 6.2 要求快照的間隔、變更閾值與最大筆數。
- **Decision**：
  - 快照保存的是 Auto Save 即將覆蓋的完整 Markdown（不是 diff），並記錄當時的 revision。
  - 觸發：本編輯週期第一次變更；之後距上一張快照滿 10 分鐘；或單次變更長度差 ≥ 500 字元（防止一次誤刪大段內容）。內容與上一張快照相同或為空白時不存。
  - 每篇最多保留 50 張，超過時刪除最舊的。
  - Publish 在建立 Published Version 的同一交易中刪除該文章所有快照（Baseline 6.2：持久化即可清除，不必等部署）。
  - 還原：把快照的 Markdown 經由 Auto Save 寫回（需 `base_revision`），被取代的內容也會成為快照，因此還原可以再復原。CMS 的還原請求與 Auto Save 走同一個佇列。
  - 快照是圖片 GC 的有效引用（BE-007）。

### BE-009：CMS 管理員登入

- **Status**：Accepted (delegated)
- **Context**：Baseline 5.1、第 10 節第 7 條。使用 Cloudflare Access 的部署不用密碼，見 BE-026。
- **Decision**：
  - 單一管理員，密碼以 scrypt（隨機 salt）雜湊存於 `admin_credentials`（CHECK 限制只有一筆）。以 CLI `python -m blog.auth` 設定，最少 12 字元、最長 1024 字元；設定新密碼時清除所有 session。
  - 伺服器端 session：cookie 只放隨機 token（`HttpOnly`、`SameSite=Strict`），資料庫只存 token 的 SHA-256。登入後 3 天失效，閒置 1 天也失效。登入時順便清除過期 session。CMS 提供「登出所有裝置」。
  - 除 `/api/session` 外，所有 `/api/*` 都需要登入，否則回 401。`/admin/` 靜態頁面本身不需要登入，但沒有登入就無法取得任何資料。
  - 會修改資料的請求，若 `Origin` 不是 `CMS_ORIGIN`（沒有設定時為請求自己的 scheme 與 host）則回 403（SameSite 之外的第二道 CSRF 防線）。
  - 登入節流存在資料庫的 `sign_in_attempts`，依來源位址計算，在檢查密碼前先計數。連續 5 次失敗後以 30 秒起倍增、最長 15 分鐘的間隔封鎖，成功登入即清除。同時驗證密碼的請求每個程序最多 2 個。
  - `COOKIE_SECURE` 的預設值由 `CMS_ENV` 決定（`cloud` 開啟、`local` 關閉）。開啟時 cookie 名稱為 `__Host-cms_session` 並加 HSTS。
  - CMS 在 session 過期時以覆蓋層顯示登入表單，不卸載編輯器；重新登入後自動補存未儲存的內容。
- **Consequences**：以 HTTPS 提供的 CMS 必須開啟 `COOKIE_SECURE`。節流存在資料庫，所以多個程序共用同一份計數。

### BE-010：從 CMS 更新網站與部署追蹤

- **Status**：Accepted (delegated)
- **Context**：PUB-004（CMS 觸發 workflow）、PUB-005（失敗通知）、Baseline 9.1（DB 發布與部署成功是不同事件）、9.3。
- **Decision**：
  - CMS「網站發布 → 更新網站」建立一個背景工作（BE-022），依序：匯出 Snapshot 並寫入內容 repo（git push 或 Git Data API）→ 以 `workflow_dispatch` 啟動 `deploy.yml`，輸入該 commit。距上一筆 release 不到 30 秒時拒絕。
  - 每次匯出記為一筆 `releases`，並以 `release_articles` 記錄其中每篇文章的版本（供 Baseline 6.3 的版本清理使用）。
  - Release 狀態：`exported → pushed → dispatched → building → deployed`；也可能是 `superseded`（被較新的 release 或 run 取代，或部署步驟被跳過）或 `push_failed`／`dispatch_failed`／`failed`。
  - 以 workflow 的 `run-name: Deploy content <sha>` 找到對應的 run：只列出最近一次 dispatch 前 5 分鐘（容許 CMS 與 GitHub 的時鐘誤差）之後建立的 `workflow_dispatch` run，取 id 大於上次記錄的 run（重試會再啟動一次）；dispatch 後 30 分鐘還找不到記為 failed。run 被取消記為 superseded；run 成功但 `Deploy to GitHub Pages` 步驟被跳過也記為 superseded。
  - 只有最新一筆 release 可以重試；重試會從失敗的那一步繼續。新 release 建立時，較舊且還沒啟動部署的 release（exported、push_failed、pushed、dispatch_failed）標記為 superseded；已 dispatched／building 的留給 GitHub 的結果判斷。
  - 狀態在開啟「網站發布」頁面時向 GitHub 查詢；有未完成的 release 時每 15 秒更新一次。不自動重試，失敗通知沿用 GitHub 的 Email（PUB-005）。
- **Consequences**：測試以假的 GitHub API 與本機 bare repo 執行；作者在 2026-10-20 以真實的內容 repo 與 Pages 走完全流程。

### BE-011：Published Version 保留與清理

- **Status**：Accepted (delegated)
- **Context**：Baseline 6.3。
- **Decision**：一個 Published Version 只有在以下條件全部成立時才刪除：
  1. 不在該文章最新的 3 個版本內。
  2. 不屬於最新一筆 `deployed` release，也不屬於任何進行中（exported、pushed、dispatched、building）的 release。
  3. 存在一個比它新、且在最新 `deployed` release 建立之前就已發布的版本（新版本確實已上線）。
  4. 文章不在 Pending Deletion（30 天內保留所有版本以供復原）。
  - 在 release 確認上線時，以及每次 `python -m blog.maintenance` 時執行；可重複執行。`failed`、`superseded` 的 release 不算上線。
  - 被刪除版本引用的圖片，之後依 BE-007 的 7 天規則回收。
- **Consequences**：部署失敗或從未部署時不會刪除任何版本，因此可能保留超過 3 版（符合 Baseline 6.3）。

### BE-012：資料庫備份方式

- **Status**：Confirmed（使用者 2026-10-20 指定）
- **Context**：PUB-006（內容 repo 不能取代 CMS 備份）。
- **Decision**：
  - `scripts/backup.sh` 以 `pg_dump` 備份整個資料庫並附 `.sha256`。目標是 `BACKUP_TARGET`（資料夾或 `s3://`），沒有設定時是 `backend/backups/`，由 `.gitignore` 排除，不進 git。
  - 本機 CMS 每次以 `backend/scripts/start.sh` 啟動時先備份，順序在 migration 之前；執行期間另有每日備份（BE-025）。使用者自行把備份資料夾放在雲端硬碟同步的位置，或設定 `BACKUP_TARGET`。
  - 雲端 CMS 由主機 cron 每天備份到主機的備份資料夾；EC2 另同步到 S3（BE-027）。`cms-v*` 部署在 migration 前也先備份（BE-021）。
  - 舊備份預設不自動刪除；設定 `BACKUP_KEEP` 時只保留資料夾中最新 N 份。
  - 還原以 `scripts/restore.sh`（雲端用 `cloud-restore.sh`）：驗證 checksum、確認後取代整個資料庫，再執行 migration（PUB-010）。

### BE-013：Topic／Tag 以最後儲存的名稱為準

- **Status**：Confirmed（使用者 2026-10-20 指定）
- **Context**：第一篇測試文章的 Tag 名稱打錯。若沿用 slug 第一次建立時的名稱，修正後重新發布仍顯示舊名稱。名稱出現在文章頁、Tag 頁標題與 metadata，錯誤名稱無法修正會影響 SEO。
- **Decision**：Draft 寫入（Auto Save、Publish）帶入的 `{slug, name}` 中，slug 已存在時以本次的名稱覆寫。名稱屬於 Topic／Tag 本身，所以所有引用該 slug 的草稿與已發布版本都顯示新名稱。
- **Consequences**：
  - 已發布版本的 Tag／Topic 名稱會跟著改，這不違反版本不可變性：`published_version_tags` 只記錄引用，名稱不屬於版本內容。
  - 下次「更新網站」時，Exporter 匯出新名稱，所以內容 repo 會出現新的 release commit。
  - 同一個 slug 在兩個同時開啟的編輯器中填了不同名稱時，最後存檔的一方生效。
  - URL 由 slug 決定，改名不會改變網址。合併與刪除見 BE-019。

### BE-014：上傳時縮圖並轉成 WebP

- **Status**：Confirmed（使用者 2026-10-20 指定）
- **Context**：第一篇測試文章上傳了 2560px 寬、368 KB 的截圖。原圖照原樣存入並發布，讀者下載的檔案遠大於需要。
- **Decision**：
  - 上傳的圖片寬度超過 1440px（內文欄寬 720px 的兩倍，讓 Retina 螢幕上的截圖文字保持清晰）時，等比例縮到 1440px；較窄的圖片不放大。
  - 一律重新編碼成有損 WebP，quality 85。透明背景保留。
  - 動態 GIF 轉成動態 WebP，保留每格的時間長度與循環設定，每格同樣縮寬。
  - JPEG 的 EXIF 方向先套用到像素上，再丟棄所有 EXIF，所以照片的 GPS 位置等資訊不會公開。
  - 圖片 id 改為「轉檔後內容」的 `<sha256>.webp`。上傳相同檔案仍得到相同 id。
  - 檔案大小上限 10 MB 與可接受的格式（PNG、JPEG、GIF、WebP，以檔案內容判斷）不變。簽章正確但無法解碼的檔案回 415。
- **Consequences**：
  - 後端新增依賴 Pillow。
  - 實測：2560×1316、368 KB 的 PNG 截圖轉成 1440×740、58 KB 的 WebP，耗時約 0.1 秒。
  - 已上傳的舊圖片維持原格式，不回溯轉檔。要換成 WebP 時，重新上傳並替換文章中的引用即可。
  - 原圖不保留，日後無法以更高解析度重新產生。

### BE-015：首次發布時間存在文章上

- **Status**：Confirmed（使用者 2026-10-20 確認為 bug）
- **Context**：BE-004 規定 `published_at` 為第一次發布的時間。若從「資料庫中仍存在的最舊版本」推算，BE-011 刪除舊版本後，網站上的日期會往後移，下一次「更新網站」也會因此多出一個 release commit。
- **Decision**：
  - `articles.first_published_at` 在文章第一次 Publish 時寫入，之後不再改變。封存後重新發布（Republish）沿用原本的時間，因為 `doc_id` 不變，對讀者是同一篇文章。
  - Exporter 的 `published_at` 讀這個欄位。
  - 資料庫 CHECK：`published`、`archived` 狀態的文章必須有 `first_published_at`。
  - Migration 0007 以每篇文章現存版本中最早的 `published_at` 回填。
- **Consequences**：migration 0007 之前已被 BE-011 刪掉第一版的文章，回填值是剩下最早版本的時間，無法還原真正的首次發布時間。

### BE-016：中斷的「更新網站」由下一次接續完成

- **Status**：Accepted (delegated)
- **Context**：git 模式（`CONTENT_REPO_DIR` 指向內容 repo clone）先在 clone 中 commit，再寫入 `releases`。git 與資料庫無法放在同一個交易，兩步之間失敗會留下兩種狀態：寫入但未 commit 的檔案，或資料庫沒有記錄的 release commit。若以目前的檔案判斷內容有沒有變，兩種情況下之後的匯出都認為「沒有變更」，在內容再次修改之前無法更新網站。API 模式的中斷處理見 BE-022。
- **Decision**：
  - 每次匯出前，先把 Snapshot 路徑（`manifest.json`、`profile.json`、`articles/`、`images/`）重設回 HEAD，丟棄中斷的匯出留下的檔案。有沒有變更一律與上一個 commit 比較。PUB-003 的「失敗時不 commit」由下一次匯出丟棄寫到一半的檔案來達成，不另用暫存目錄。
  - 匯出後，從 HEAD 讀出 release：commit 訊息為 `Release <id>` 且與 HEAD 的 `manifest.json` 中的 `release_id` 相同。資料庫還沒有這筆 release 時就建立它，然後照常 push 與啟動部署。內容 repo 的其他 commit（例如初始 commit）不會被當成 release。
  - 匯出期間被 Purge 的文章沒有資料列可以引用，不寫入 `release_articles`。
- **Consequences**：
  - 任何一步失敗後，再按一次「更新網站」即可完成；不需要手動整理內容 repo。
  - 從備份還原資料庫後，若資料庫內容與 HEAD 相同，HEAD 的 release 會被重新記錄並再部署一次相同內容。

### BE-017：關於頁資料與 `profile.json` 匯出

- **Status**：Confirmed（使用者 2026-10-21 指定）
- **Context**：Addendum 04 FE-007 把關於頁改由 CMS 編輯。
- **Decision**：
  - 資料表 `profile` 只有一列（CHECK `id = 1`），欄位為 `revision`、`content`（JSONB）、`updated_at`。Migration 0008 建立時寫入預設內容（FE-007）。
  - `GET /api/profile` 回傳 `{revision, content, updated_at}`；`PUT /api/profile` 帶 `{revision, content}`，鎖定該列後比對 revision，成功時 revision +1，不符時回 409 與 `current_revision`（與 BE-002 相同的形狀）。和其他 `/api/*` 一樣需要登入。
  - API 以 Pydantic 驗證：字串去除前後空白；名字、連結名稱、經歷職稱、作品名稱、作品 tag 不可空白；網址必須是 `https://` 或 `mailto:` 開頭；長度上限為名字 100、標語與單行欄位 200、說明 2000、自我介紹 20000 字，每個清單最多 50 項，每個作品最多 20 個 tag。不合法回 422。
  - Exporter 在同一交易中讀取 profile，寫成 Snapshot 根目錄的 `profile.json`，鍵的順序固定。`profile.json` 是 Snapshot 路徑之一（BE-004），所以只修改介紹也會產生新的 release commit。
  - 自我介紹引用的 `images/` 圖片一起匯出，並算作圖片 GC 的有效引用（BE-007）；儲存時清除這些圖片的 `unreferenced_since`。
  - `schema_version` 為 1；沒有 `profile.json` 的 Snapshot，前端使用預設內容。
  - 網站名稱與簡介（Addendum 04 FE-009）存在同一列的 `content.site`，形狀為 `{title, description}`：名稱不可空白、上限 100 字，簡介可空白、上限 300 字。沒有 `site` 鍵的資料，讀取時由 Pydantic 預設為 `{title: "Personal Blog", description: ""}`。`PUT` 省略 `site` 時同樣存成預設值。`profile.json` 中 `site` 排在最後，其他鍵的順序不變。頁尾文字 `site.footer`（FE-010）可空白、上限 200 字，沒有此鍵的資料讀取時預設為空字串。
- **Consequences**：
  - 關於頁沒有版本或快照紀錄；儲存即覆蓋，上線的版本以內容 repo 的 commit 歷史為準。

### BE-018：文章摘要、封面、系列與置頂

- **Status**：Confirmed（使用者 2026-10-21 指定）
- **Decision**：
  - Working Draft 與 Published Version 新增 `excerpt`（可空白、上限 300 字、前後空白去除）、`cover`（圖片 id，可為 null）與 `series_id`（可為 null）。系列存在 `series` 表，規則與 Topic 相同（BE-013：slug 唯一，最後儲存的名稱為準）。三者隨 Auto Save 儲存、隨發布複製到新版本。
  - 發布時 `cover` 必須是 Markdown 引用的圖片（規則同 BE-014），否則 422。封面一定在內文中，所以圖片引用與清理規則不變。
  - 置頂存在文章上（`articles.pinned_at`），不屬於版本，`PUT /api/articles/{doc_id}/pinned`（`{"pinned": bool}`）切換，已置頂再置頂不更新時間。文章列表回傳 `pinned`。
  - 匯出：文章檔只在有值時輸出 `excerpt`、`cover`（`images/<id>`）、`series`、`pinned_at`；最新版本號大於 1 時輸出 `updated_at`（最新版本的發布時間）。
  - Migration 0009 新增上述欄位與 `series` 表，既有資料預設為空。
- **Consequences**：前端解析見 Addendum 04 FE-011。

### BE-019：Topic、Tag 與系列的管理

- **Status**：Confirmed（使用者 2026-10-21 指定「待開發清單全部都做」，合併的版本處理依 BE-013 的理由決定，使用者可推翻）
- **Context**：Baseline 4.2：Taxonomy 的改名、合併、刪除與版本引用。
- **Decision**：
  - CMS 新增「分類管理」頁。`GET /api/taxa` 依種類（`topics`、`tags`、`series`）列出 slug、名稱、篇數（未在待刪除區、目前草稿使用它的文章數）與是否仍被任何草稿或保留中的 Published Version 引用。
  - 改名：`PUT /api/taxa/{kind}/{slug}`（`{"name"}`），與 BE-013 相同，所有引用處都顯示新名稱；slug 不能改。
  - 合併：`POST /api/taxa/{kind}/{slug}/merge`（`{"into"}`）把所有草稿與 Published Version 改指向目標，再刪除來源。和 BE-013 一樣，Topic／Tag／系列是誰屬於 Taxonomy 的身分，不屬於版本內容，所以已發布的文章也跟著改；`published_versions` 的不可變 trigger 改為只允許 `topic_id`、`series_id` 變動（migration 0010），Tag 透過 join table 的刪除與新增完成，不需要 UPDATE。同一篇已同時有來源與目標的 Tag 只留一筆。
  - 刪除：`DELETE /api/taxa/{kind}/{slug}` 只在沒有任何草稿或 Published Version 引用時成功，否則 409。
- **Consequences**：
  - 合併後來源的公開網址（例如 `/tags/js/`）在下次部署後消失；GitHub Pages 無法轉址，CMS 在合併前提示。
  - 仍開著、填著來源 slug 的編輯器下次自動儲存會重新建立它（BE-013 的 get-or-create），CMS 頁面上有說明。
  - 別名策略沒有提供（Baseline 12 Open Questions）。

### BE-020：Tailscale 做法的雲端 CMS 只透過 Tailscale 存取

- **Status**：Confirmed（使用者 2026-10-22 決定）
- **Context**：本機 CMS 只綁定 `127.0.0.1`，存取控制靠「只在自己的電腦上」。放到雲端主機後，若登入頁對網際網路公開，CMS 只有一組密碼。這是 fork 可選的雲端做法；作者的 CMS 用 Cloudflare Access（BE-026）。
- **Decision**：
  - 主機不開任何進站連接埠，管理只用 Tailscale SSH。
  - `tailscale serve` 以 `*.ts.net` 憑證提供 HTTPS，轉給只綁定 `127.0.0.1:8000` 的 CMS。
  - Tailscale ACL 只允許作者的帳號連到主機，並開啟裝置核准。主機的金鑰不到期，作者裝置的金鑰保留到期。
  - 不另外加 TOTP：通過核准的裝置是第一道驗證，密碼是第二道。
- **Consequences**：雲端的 CMS 設 `CMS_ENV=cloud`，`ALLOWED_HOSTS` 與 `CMS_ORIGIN` 用主機的 MagicDNS 名稱。步驟與裝置遺失時的處理見 [`cloud-tailscale.md`](../cloud-tailscale.md)。密碼登入的 CMS 不應開放給 tailnet 以外的網路；要經公開網址連線時改用 BE-026。

### BE-021：本機與雲端用同一份程式碼，雲端 CMS 以 tag 部署

- **Status**：Confirmed（使用者 2026-10-22 決定）
- **Context**：CMS 要能在自己的電腦或雲端主機執行。若為雲端開一條長期分支，每個修正都要做兩次，CI 與部署也都綁在 `main`。
- **Decision**：
  - 不開長期的雲端分支。能用同一種做法同時適用本機與雲端的，就不做成選項，例如定期維護是同一個指令 `python -m blog.maintenance`（PUB-005）。
  - 只有真的不同的設定放進 `.env`，由 `backend/blog/config.py` 啟動時一次讀取並檢查。`CMS_ENV=local|cloud` 只決定預設值，每一項都能個別覆寫。
  - 合併到 `main` 只部署公開網站，不更新雲端 CMS。推送 `cms-v*` tag 時才部署 CMS：先跑 `ci.yml` 與 `cms-image.yml`（image 的 migration、備份還原與 `/healthz` 檢查），兩者都通過才建置並發布 image，再在主機上備份、執行 migration、啟動新容器並檢查 `/healthz`。workflow 經 Tailscale（預設，BE-020）或 AWS SSM（`CMS_DEPLOY_VIA=ssm`，BE-027）連到主機，主機不開進站連接埠。
- **Consequences**：fork 這個專案的人可以自己選本機或雲端。`cms-v*` 的部署 workflow 是 `.github/workflows/cms-deploy.yml`，預設停用，repo variable `CMS_DEPLOY_ENABLED=true` 才會執行。作者的運算服務見 BE-027。步驟見 [`cms-deployment.md`](../cms-deployment.md)。

### BE-022：本機與雲端共用發布流程

- **Status**：Confirmed（使用者 2026-10-22 決定）
- **Decision**：
  - 同一份 CMS 程式以環境設定選擇資料庫、網址、備份位置與憑證。
  - 內容 repo 的寫入方式以 `CONTENT_TRANSPORT` 選擇：`git` 用 `CONTENT_REPO_DIR` 指向的本機 clone 與 git push；`api` 用 Git Data API 寫入 `CONTENT_REPO`，不需要 clone。預設 `auto`：有 `CONTENT_REPO` 時用 API，否則用 git。容器裡沒有 clone，所以雲端 CMS 用 API。
  - GitHub 認證可用 personal token（`CMS_GITHUB_TOKEN`）或 GitHub App（`GITHUB_APP_*`）。App 私鑰由執行環境提供，後端自動取得短效 installation token。作者用 App。
  - 「更新網站」先把背景工作存進 `release_jobs` 並回應 202。worker 匯出 Snapshot、準備 commit、保存內容與部署目的地後，才更新遠端分支。中斷後重試接續同一個 commit；API 模式以 parent 比對遠端 HEAD，其他 writer 改變 HEAD 時拒絕覆蓋。git 模式以 `ls-remote` 檢查遠端有沒有這個 CMS 不認得的 commit。
  - 公開網站仍由 Actions 讀取 Snapshot 建置，不連回 CMS。`cms-v*` tag 的 CMS 主機部署獨立且預設停用。
- **Consequences**：完整設定與切換見 [`portable-cms.md`](../portable-cms.md)。

### BE-023：文章 slug 與匯出過的網址

- **Status**：Confirmed（使用者 2026-10-26 指定）
- **Context**：Addendum 04 FE-015 讓文章可以用英文 slug 當網址。網址換過之後，舊網址要能轉到新網址，而且不能被另一篇文章拿去用。
- **Decision**：
  - `articles.slug` 可為空，格式是小寫英數字與單一 `-`，最多 80 字。`page` 是保留字，因為 `/posts/page/<n>/` 是文章列表的分頁。
  - `PUT /api/articles/{id}/slug` 設定或清除 slug，不建立新版本，下一次「更新網站」生效。格式不符回 422。被占用時回 409，並建議第一個可用的 `<slug>-2`、`-3`。編輯器在欄位失焦時先在本機檢查格式，再直接送出 `PUT`，衝突由 409 處理。
  - `article_urls`（migration 0016）記錄每篇文章實際匯出過的網址片段，包括 `doc_id` 與 slug，在建立 release 時寫入。migration 0016 替已經發布過的文章補上 `doc_id`。
  - 另一篇文章目前使用的 slug，以及另一篇文章匯出過的片段，都不能使用。只在 CMS 打錯、還沒匯出過的 slug 可以再給別篇用。
  - 匯出時，manifest 的每篇文章帶目前的 `slug`，以及 `redirect_from`，也就是 `article_urls` 裡目前網址以外的片段。沒有時兩個 key 都省略，`schema_version` 維持 1。
  - 永久刪除文章時，`article_urls` 隨文章一起刪除，用過的 slug 跟著釋出。
- **Consequences**：建立 release 時，`record_export` 先查目前誰擁有每個匯出的 slug；匯出期間 slug 已移到另一篇文章時，不記成原文章的舊網址。`set_slug` 與 `record_export` 在讀取占用情況前，都先取得同一把交易層級的 advisory lock（`pg_advisory_xact_lock`），直到各自 commit 才放開，所以 B 設定 slug 一定看得到已記錄的 (A, X)，`record_export` 也一定看得到 B 已 commit 的 slug。這把鎖會等待而不是拒絕：「更新網站」只在寫入 release 紀錄的交易期間持有它，不包括匯出、push 與部署，所以 slug 儲存最多等這筆資料庫交易結束。兩邊都在取得任何文章列鎖之前先取這把鎖，因為寫入 `release_articles` 與 `article_urls` 會透過外鍵鎖住文章列，順序相反會死結。

### BE-024：CMS 的流量數據頁

- **Status**：Confirmed（使用者 2026-10-26 指定）
- **Context**：作者想看網站流量與搜尋表現，但公開網站不放分析或追蹤程式（Baseline 3.3）。網站接上 Cloudflare 與 Google Search Console 之後，兩者都有可以從伺服器讀取的 API。
- **Decision**：
  - `backend/blog/analytics.py` 在伺服器端讀 Cloudflare GraphQL Analytics API 與 Google Search Console API，存進 `traffic_days`、`search_days` 與 `analytics_sources`（migration 0015）。公開網站完全不變。
  - 預設關閉。設定 `CLOUDFLARE_API_TOKEN` 與 `CLOUDFLARE_ZONE_ID`，或 `GSC_SITE_URL` 與 `GSC_CREDENTIALS_FILE`，才啟用對應的來源；每一對只設一個時 CMS 不啟動。Cloudflare token 只給 Analytics 唯讀權限。Google 用服務帳戶金鑰，本機放在 git 忽略的 `backend/secrets/`，EC2 由主機設定腳本從 SSM 寫入 secrets 資料夾。
  - 沒有排程。開啟 CMS「流量數據」頁時，資料超過 6 小時就先更新一次。「立即更新」強制更新。重抓的日期整天覆蓋，所以重複更新不會重複計算。
  - 任何 HTTP 或格式錯誤都變成同一種錯誤，訊息遮掉 token，存起來給 CMS 顯示。一個來源失敗不影響另一個，API 仍回 200。
  - `GET /api/analytics?days=7|28|90` 回報表，`POST /api/analytics/sync` 更新資料。圖表是 CMS 內手寫的 inline SVG，不新增套件。
  - 基礎設施區塊：設定 `AWS_INSTANCE_ID` 與 `AWS_REGION` 時，同一頁顯示 CMS 主機的每日 CPU（平均與最高）、網路流入與流出、狀態檢查失敗次數；另設 `BACKUP_BUCKET` 時顯示最近一次備份、bucket 大小與檔案數。`backend/blog/infra.py` 以 boto3 呼叫 CloudWatch `GetMetricStatistics` 與 S3 `ListObjectsV2`，憑證來自主機的 instance role，只用免費額度內的 API。資料不存進資料庫：CloudWatch 本身保留 15 個月的每日資料，所以每次開頁時查詢，結果在記憶體保留 5 分鐘，「立即更新」重新查詢（`GET /api/infrastructure`）。沒有設定時 CMS 不呼叫 AWS。
- **Consequences**：Cloudflare 第一次只能取得最近 30 天，90 天的圖要慢慢累積。Search Console 的資料約晚 2–3 天。主機沒有 CloudWatch agent，所以沒有記憶體與磁碟用量；S3 的 bucket 大小約晚一天。設定步驟見 [`analytics.md`](../analytics.md)。實作時沒有用真實帳號的 Cloudflare 與 Search Console API 回應測試。

### BE-025：CMS 執行期間每日備份

- **Status**：Confirmed（使用者 2026-10-28 指定）
- **Context**：`start.sh` 只在啟動時備份（BE-012）。電腦一直開著時，本機 CMS 可以好幾天不重啟，最新的備份就停在啟動那天。換電腦時要靠雲端硬碟上的最新備份還原。
- **Decision**：
  - `backend/blog/backups.py` 的 `Scheduler` 在 CMS 執行期間，距離上次成功備份滿 `BACKUP_EVERY_HOURS` 小時就執行 `scripts/backup.sh`。本機預設 24，雲端預設 0（關閉），因為雲端主機已用 cron 排程備份到容器外。
  - 排程在 CMS 程序裡，不用 cron 或 launchd。備份以 CMS 的子程序執行，沿用它的環境變數、PATH 與 macOS 的資料夾權限，寫入雲端硬碟同步的資料夾不需要另外設定「完整取用磁碟」。
  - 用牆上時間比較，每 10 分鐘檢查一次，所以睡眠的時間也算在間隔內。失敗只記 log，下次檢查再試。
  - 清舊檔沿用 `BACKUP_KEEP`，預設保留全部。
  - CMS 關閉時，對備份的 process group 送 SIGTERM。`stop_cms` 等 CMS 程序結束而不只等 port 關閉，所以先停 CMS 的 `restore.sh` 不會與排程備份的清理同時進行。強制結束 CMS 時沒有這個保證，正在跑的備份會自己跑完。
- **Consequences**：CMS 關著時沒有每日備份；資料只在 CMS 開著時改變，所以沒有遺漏。直接執行 `uvicorn` 而不經 `start.sh` 時，第一份排程備份在啟動滿一個間隔後才出現。

### BE-026：經公開網址連線的雲端 CMS 以 Cloudflare Access 登入

- **Status**：Confirmed（使用者 2026-10-29 決定）
- **Context**：作者的雲端 CMS 經 Cloudflare Tunnel 對外，放在 `cms.<網域>`，不只 tailnet 裡的裝置連得到，所以 BE-020 以核准裝置當第一道驗證的做法不適用。CMS 自己只有一組密碼。
- **Decision**：
  - Cloudflare Access 擋在 `cms.<網域>` 前面，以 GitHub 為登入方式，session 24 小時，policy 只允許作者的 email。
  - 設定 `CLOUDFLARE_ACCESS_TEAM_DOMAIN`、`CLOUDFLARE_ACCESS_AUD` 與 `CLOUDFLARE_ACCESS_EMAILS` 時，CMS 不接受密碼登入。三個要一起設定，否則 CMS 不啟動。沒有設定時，密碼與 session cookie 的行為完全不變。
  - `backend/blog/cloudflare_access.py` 每個請求都驗證 `Cf-Access-Jwt-Assertion` 的 JWT。只接受 RS256，檢查 AUD、issuer、`exp` 與 `iat`（容許 60 秒時鐘誤差），email 必須在 `CLOUDFLARE_ACCESS_EMAILS` 裡。公鑰從 team domain 的 `/cdn-cgi/access/certs` 取得並快取。
  - 除了 `/healthz`，所有路徑都要通過驗證，包括 `/admin/` 的檔案。沒有或無效的 JWT 回 403，取不到公鑰回 503。
  - CMS 不發 session，也不存登入狀態。`GET /api/session` 多回 `method`（`password` 或 `cloudflare`）。這個模式下密碼登入與登出的 API 回 409，登出改到 `/cdn-cgi/access/logout`，撤銷在 Cloudflare 執行。
  - 不安全方法仍檢查 Origin，audit log 多記 `user=<email>`。
- **Consequences**：主機不能有繞過 Cloudflare 的入口，因為撤銷 session 只在 Cloudflare 生效，CMS 只看 JWT 本身。Access 應用程式要在 tunnel 的 hostname 上線前建立。主機要能對外連到 team domain，取不到公鑰時 CMS 無法使用。步驟見 [`cloud-ec2.md`](../cloud-ec2.md)。
- **Rejected**：
  - 用 JWT 換 CMS 自己的 session cookie。在 Cloudflare 撤銷 session 後，cookie 仍然有效，除非每個請求還是檢查 JWT，那就不需要 cookie。
  - 信任 Access 而不驗證 JWT。tunnel 或 policy 設錯一次，CMS 就直接公開。
- **Scope**：只用 Tailscale 存取的部署以 BE-020 為準，使用密碼登入。

### BE-027：作者的雲端 CMS 放在 EC2，經 SSM 部署

- **Status**：Confirmed（使用者 2026-10-29 決定）
- **Context**：BE-021 讓 CMS 可以部署到雲端主機，運算服務由部署者選擇。作者的 CMS 放在 AWS；fork 的人預設在自己的電腦執行 CMS。
- **Decision**：
  - 單台 EC2（x86-64、Amazon Linux 2023）執行 CMS、PostgreSQL 與 `cloudflared` 三個容器。主機沒有進站規則，也沒有 SSH 金鑰，管理用 SSM Session Manager。
  - 作者經 Cloudflare Tunnel 連到 `cms.<網域>`，登入方式見 BE-026。
  - `cms-deploy.yml` 以 `CMS_DEPLOY_VIA=ssm` 選擇 SSM Run Command，GitHub Actions 用 OIDC 取得只能對這台主機執行 `AWS-RunShellScript` 的 role。主機上執行的部署腳本與 Tailscale 做法相同。
  - 主機與周邊資源由 CloudFormation `infra/aws/cms-ec2.yaml` 建立。CMS 的設定與密鑰存在 SSM Parameter Store，`cloud-host-setup.sh` 讀取它們、設定主機並寫入排程，`cloud-restore.sh` 搬入既有備份。
  - 主機 cron 每小時執行維護，每天備份到 `/srv/blog/backups` 並同步到開啟版本控制的 S3 bucket。主機 role 對 bucket 只能寫入與列出 `cms/` 前綴，不能讀取或刪除。
  - 選 EC2 而不選 Lightsail，是因為 SSM 與 IAM instance role 在 EC2 上內建。
- **Consequences**：沒有設定 `CMS_DEPLOY_VIA` 時，部署仍走 Tailscale，fork 的行為不變。資料庫在主機的磁碟上，主機被取代時資料不會跟過去，所以 stack 固定 AMI ID，並保留被取代的主機。步驟見 `docs/cloud-ec2.md`。
