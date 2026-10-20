# Personal Blog — Addendum 03：Backend Foundation

> **基線**：[Baseline v1.0](./personal-blog-system-spec-baseline-v1.0.md)，[Addendum 01](./personal-blog-system-spec-addendum-01-domain-model.md)，[Addendum 02](./personal-blog-system-spec-addendum-02-publishing-pipeline.md)
> **日期**：2026-10-20
> **Status 說明**：使用者授權「剩下的架構規劃按助理建議」，以下標為 Accepted (delegated)。使用者可隨時推翻。

## Decisions

### BE-001：後端技術組合

- **Status**：Accepted (delegated)
- **Context**：Baseline 12 的 Database／Backend 項目未決定 ORM、遷移工具與套件管理。
- **Decision**：Python 3.12+、FastAPI、SQLAlchemy 2（ORM）、Alembic（schema migration）、psycopg 3、python-ulid、pytest + HTTPX（測試）、uv（套件與虛擬環境管理）。本機 PostgreSQL 16 以 `backend/compose.yaml` 執行。
- **Consequences**：測試直接使用真實 PostgreSQL（列鎖、trigger 等行為無法用 SQLite 取代）。CI 以 PostgreSQL service container 執行。

### BE-002：ART-020／ART-021 的資料表與 API 形狀

- **Status**：Accepted (delegated)
- **Decision**：
  - 資料表：`articles`（內部 PK + 唯一 `doc_id`，CHECK 為大寫 ULID）、`working_drafts`（以 `article_id` 為 PK，一篇一份）、`published_versions`（`UNIQUE(article_id, version)`）、`topics`、`tags`、`working_draft_tags`、`published_version_tags`。
  - `published_versions` 與 `published_version_tags` 由 trigger 拒絕 `UPDATE`；`DELETE` 保留給版本清理（Baseline 6.3）。
  - Auto Save 與 Publish 都帶 `base_revision`；不符時回 409 與 `current_revision`。
  - Publish 請求帶入作者畫面上的完整內容；後端在同一交易中鎖定 draft 列、寫入內容、revision +1、建立下一個版本號。這是 ART-021 第 3 點中「寫入使用者按下 Publish 當下的內容」的選項。
  - Publish 要求 Title 與 Markdown 非空白。
- **Supersedes**：無；細化 ART-021。

### BE-003：Topic／Tag 暫以 slug 自動建立

- **Status**：Accepted (delegated)，暫行
- **Decision**：Draft 請求以 `{slug, name}` 指定 Topic／Tags；slug 不存在時自動建立，已存在時沿用既有名稱。
- **Consequences**：Taxonomy 管理（改名、合併、刪除）仍未決定（Baseline 12）；屆時可能取代本決策。
- **Superseded by**：BE-013（已存在的 slug 改為採用最後儲存的名稱）。

### BE-004：Content Exporter 的匯出規則

- **Status**：Accepted (delegated)
- **Decision**：
  - 每篇有 Published Version 的文章匯出其最新版本；`published_at` 為該文章第一次發布的時間（Baseline 3.1 的「發表日期」）。
  - 從未發布的文章與所有 Working Draft 內容都不匯出。
  - 先在記憶體中產生完整 Snapshot，再寫入內容 repo；若與目前內容相比只有 `release_id`／`created_at` 不同，則不寫入也不 commit。
  - 只 stage `manifest.json`、`articles/`、`images/`；內容 repo 中的其他檔案不受影響。
  - 前後端各自解析 Snapshot；後端測試以前端 parser（`frontend/scripts/check-snapshot.ts`）驗證匯出結果，作為兩邊的契約測試。
- **Consequences**：觸發 deploy workflow（PUB-004）尚未實作，需先完成 `docs/setup-todo.md` 的 B4 token。

### BE-005：Article Lifecycle 狀態機

- **Status**：Accepted (delegated)
- **Context**：Baseline 7.1–7.4；Baseline 12「恢復」的細部規則未決定。
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
  - 待刪除滿 30 天的文章在 CMS 啟動時清除（PUB-005）；可重複執行。
  - Exporter 只匯出 published 的最新版本；archived 只列入 `archived_articles`；draft 與 pending_deletion 都不匯出。
- **Consequences**：Purge 只刪除資料庫資料；已部署的靜態網站在下一次部署前仍顯示舊內容（Baseline 7.1 的最終一致性）。圖片尚未實作，Purge 與圖片 GC 的協調留待圖片功能。CMS 執行期間的定期清除尚未實作，目前只在啟動時執行。
- **Supersedes**：Baseline 12「恢復」項目中「回到哪個狀態」的部分。

### BE-006：CMS 編輯器前端

- **Status**：Accepted (delegated)
- **Context**：Baseline 5.1（HackMD 式分割編輯、Auto Save）；Baseline 2.1「CMS 前後端同源或分離」未決定。
- **Decision**：
  - CMS 介面為獨立的 `cms/`（Vite + React + TypeScript），build 後由 FastAPI 在 `/admin/` 提供，與 API 同源。公開網站（`frontend/`）不包含任何 CMS 程式碼。
  - Markdown 預覽使用與公開網站相同的 `marked` 版本。
  - Auto Save 停止輸入 1 秒後送出；所有 Auto Save 與 Publish 請求經由同一個佇列依序送出（`cms/src/draft-sync.ts`），每個請求都帶上前一個回應的 revision。Publish 會等進行中的存檔完成，再送出作者目前看到的內容。
  - 收到 409 時停止自動儲存並顯示「重新載入」；不自動合併。
  - 新增文章時先填 Topic（Baseline 4.2）。Tags 以 `slug:名稱` 逗號分隔輸入。
- **Consequences**：同源讓之後的登入可以直接用 cookie session，不需處理 CORS。

### BE-007：圖片上傳、匯出與 GC

- **Status**：Accepted (delegated)
- **Context**：Baseline 5.2、8.1–8.3；PUB-003、PUB-005。
- **Decision**：
  - 只能從編輯器上傳（選擇檔案、貼上、拖曳）。接受 PNG、JPEG、GIF、WebP，最大 10 MB；格式由檔案內容判斷。不接受 SVG。
  - 圖片 id 為 `<sha256>.<副檔名>`；相同內容重複上傳得到相同 id。`images`（索引）與 `image_data`（BYTEA）分開，`image_data` 由 trigger 拒絕 `UPDATE`。
  - Markdown 以 `images/<id>` 引用，與 Snapshot 路徑相同；編輯器預覽改由 `/api/images/<id>` 載入。V1 不轉檔為 WebP。
  - `images.unreferenced_since`：上傳時為上傳時間；草稿每次寫入時，被引用的圖片設為 NULL；GC 時不再被引用者記下開始時間。距今滿 7 天才刪除。
  - 有效引用：所有 Working Draft 與所有 Published Version（V1 尚未清理舊版本，所以等同全部保留版本）。待刪除文章的草稿與版本仍在，因此圖片在 30 天內受保護。
  - GC 在交易中以 SHARE 鎖鎖住 `working_drafts` 與 `published_versions`，掃描與刪除之間草稿無法新增引用。
  - GC 在 CMS 啟動時執行（取代 Baseline 8.3 的「每週五」，依 PUB-005）；可重複執行。
  - Exporter 只匯出已匯出文章所引用的圖片；引用的圖片不存在時整次匯出失敗、不寫入。
- **Consequences**：已部署網站的圖片存在內容 repo 中，不依賴資料庫，所以 GC 不會破壞線上網站。Draft Snapshots 已納入有效引用（BE-008）。
- **Supersedes**：Baseline 8.3「每週五一次」改為 CMS 啟動時執行，寬限規則不變。
- **Superseded by**：BE-014（上傳時縮圖並轉成 WebP，取代「V1 不轉檔為 WebP」）。

### BE-008：Draft Snapshots

- **Status**：Accepted (delegated)
- **Context**：Baseline 6.2 的間隔、變更閾值、最大筆數未決定。
- **Decision**：
  - 快照保存的是 Auto Save 即將覆蓋的完整 Markdown（不是 diff），並記錄當時的 revision。
  - 觸發：本編輯週期第一次變更；之後距上一張快照滿 10 分鐘；或單次變更長度差 ≥ 500 字元（防止一次誤刪大段內容）。內容與上一張快照相同或為空白時不存。
  - 每篇最多保留 50 張，超過時刪除最舊的。
  - Publish 在建立 Published Version 的同一交易中刪除該文章所有快照（Baseline 6.2：持久化即可清除，不必等部署）。
  - 還原：把快照的 Markdown 經由 Auto Save 寫回（需 `base_revision`），被取代的內容也會成為快照，因此還原可以再復原。CMS 的還原請求與 Auto Save 走同一個佇列。
  - 快照是圖片 GC 的有效引用（BE-007）。
- **Supersedes**：無；補足 Baseline 6.2 未決定的細節。

### BE-009：CMS 管理員登入

- **Status**：Accepted (delegated)
- **Context**：Baseline 5.1、第 10 節第 7 條；Baseline 12「CMS Auth」未決定。
- **Decision**：
  - 單一管理員，密碼以 scrypt（隨機 salt）雜湊存於 `admin_credentials`（CHECK 限制只有一筆）。以 CLI `python -m blog.auth` 設定，最少 12 字元；設定新密碼時清除所有 session。
  - 伺服器端 session：cookie 只放隨機 token（`HttpOnly`、`SameSite=Strict`、7 天），資料庫只存 token 的 SHA-256。登入時順便清除過期 session。
  - 除 `/api/session` 外，所有 `/api/*` 都需要登入，否則回 401。`/admin/` 靜態頁面本身不需要登入，但沒有登入就無法取得任何資料。
  - 會修改資料的請求，若 `Origin` 不是本站則回 403（SameSite 之外的第二道 CSRF 防線）。
  - 連續 5 次密碼錯誤後鎖定 15 分鐘（記憶體內計數，單一本機程序足夠）。
  - `COOKIE_SECURE` 預設關閉（本機 HTTP）；以 HTTPS 提供時必須設為 `1`。
  - CMS 在 session 過期時以覆蓋層顯示登入表單，不卸載編輯器；重新登入後自動補存未儲存的內容。
- **Consequences**：遷移到 AWS 時需要 HTTPS 與 `COOKIE_SECURE=1`；若有多個程序，登入節流需改為共用儲存。
- **Supersedes**：Baseline 12「CMS Auth」項目。

### BE-010：從 CMS 更新網站與部署追蹤

- **Status**：Accepted (delegated)
- **Context**：PUB-004（CMS 觸發 workflow）、PUB-005（失敗通知）、Baseline 9.1（DB 發布與部署成功是不同事件）、9.3。
- **Decision**：
  - CMS「網站發布 → 更新網站」依序：匯出 Snapshot 並 commit → push 到內容 repo → 以 `workflow_dispatch` 啟動 `deploy.yml`，輸入該 commit。
  - 每次匯出記為一筆 `releases`，並以 `release_articles` 記錄其中每篇文章的版本（供 Baseline 6.3 的版本清理使用）。
  - Release 狀態：`exported → pushed → dispatched → building → deployed`；也可能是 `superseded`（被較新的 commit 取代，部署步驟被跳過）或 `push_failed`／`dispatch_failed`／`failed`。
  - 以 workflow 的 `run-name: Deploy content <sha>` 找到對應的 run；以 job 中 `Deploy to GitHub Pages` 步驟是否被跳過，判斷是已上線還是被取代。
  - 只有最新一筆 release 可以重試；重試會從失敗的那一步繼續。新 release 建立時，較舊且停在失敗狀態的 release 標記為 superseded。
  - 狀態在開啟「網站發布」頁面時向 GitHub 查詢；有未完成的 release 時每 15 秒更新一次。V1 不自動重試，失敗通知沿用 GitHub 的 Email（PUB-005）。
- **Consequences**：真實的 GitHub API 呼叫要等 `docs/setup-todo.md` 的 A、B4 完成後才能驗證；目前以假的 GitHub API 與本機 bare repo 測試。
- **Supersedes**：無；實作 PUB-004 的觸發方式（Addendum 02 Open Question）。

### BE-011：Published Version 保留與清理

- **Status**：Accepted (delegated)
- **Context**：Baseline 6.3。
- **Decision**：一個 Published Version 只有在以下條件全部成立時才刪除：
  1. 不在該文章最新的 3 個版本內。
  2. 不屬於最新一筆 `deployed` release，也不屬於任何進行中（exported、pushed、dispatched、building）的 release。
  3. 存在一個比它新、且在最新 `deployed` release 建立之前就已發布的版本（新版本確實已上線）。
  4. 文章不在 Pending Deletion（30 天內保留所有版本以供復原）。
  - 在 release 確認上線時，以及 CMS 啟動時執行；可重複執行。`failed`、`superseded` 的 release 不算上線。
  - 被刪除版本引用的圖片，之後依 BE-007 的 7 天規則回收。
- **Consequences**：部署失敗或從未部署時不會刪除任何版本，因此可能保留超過 3 版（符合 Baseline 6.3）。

### BE-012：本機版的備份方式

- **Status**：Confirmed（使用者 2026-10-20 指定）
- **Context**：PUB-006（內容 repo 不能取代 CMS 備份）。
- **Decision**：
  - 第一階段（本機版）每次以 `backend/scripts/start.sh` 啟動 CMS 時，自動以 `scripts/backup.sh` 備份整個資料庫，順序在 migration 之前。
  - 備份檔放在 `backend/backups/`，由 `.gitignore` 排除，不進 git。
  - 使用者自行定期把備份複製到雲端儲存。本機舊備份不自動刪除。
  - 還原以 `scripts/restore.sh`：驗證 checksum、確認後取代整個資料庫，再執行 migration。
- **Consequences**：CMS 長時間不重啟時，期間的修改沒有新的備份；需要時可手動執行 `scripts/backup.sh`。

### BE-013：Topic／Tag 以最後儲存的名稱為準

- **Status**：Confirmed（使用者 2026-10-20 指定）
- **Context**：第一篇測試文章的 Tag 名稱打錯，修正後重新發布仍顯示舊名稱，因為 BE-003 會沿用已存在 slug 的名稱。名稱出現在文章頁、Tag 頁標題與 metadata，錯誤名稱無法修正會影響 SEO。
- **Decision**：Draft 寫入（Auto Save、Publish）帶入的 `{slug, name}` 中，slug 已存在時以本次的名稱覆寫。名稱屬於 Topic／Tag 本身，所以所有引用該 slug 的草稿與已發布版本都顯示新名稱。
- **Consequences**：
  - 已發布版本的 Tag／Topic 名稱會跟著改，這不違反版本不可變性：`published_version_tags` 只記錄引用，名稱不屬於版本內容。
  - 下次「更新網站」時，Exporter 匯出新名稱，所以內容 repo 會出現新的 release commit。
  - 同一個 slug 在兩個同時開啟的編輯器中填了不同名稱時，最後存檔的一方生效。
  - URL 由 slug 決定，改名不會改變網址。合併、刪除 Taxonomy 仍未決定。
- **Supersedes**：BE-003「已存在時沿用既有名稱」。

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
- **Supersedes**：BE-007「V1 不轉檔為 WebP」與「圖片 id 為 `<sha256>.<副檔名>`」。

## Known gaps

- ~~真實 GitHub API 與部署流程尚未在真實環境驗證。~~ 2026-10-20 已完成 `docs/setup-todo.md` A、B 區，並以測試文章走完「發布 → 更新網站 → GitHub Pages」全流程。
