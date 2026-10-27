# Personal Blog — Addendum 03：Backend Foundation

> **這是設計紀錄，不是教學。** 記錄開發時的需求與架構決策及其理由；實際行為以程式碼為準。要建立自己的部落格請看 [`fork-and-deploy.md`](../fork-and-deploy.md)。

> **基線**：[Baseline v1.0](./personal-blog-system-spec-baseline-v1.0.md)，[Addendum 01](./personal-blog-system-spec-addendum-01-domain-model.md)，[Addendum 02](./personal-blog-system-spec-addendum-02-publishing-pipeline.md)
> **日期**：2026-10-20，2026-10-27 補上 BE-023–BE-024
> **Status 說明**：標為 Accepted (delegated) 的決策，由作者授權採用設計建議，作者可隨時推翻。

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
  - 每篇有 Published Version 的文章匯出其最新版本；`published_at` 為該文章第一次發布的時間（Baseline 3.1 的「發表日期」），存在 `articles.first_published_at`（BE-015）。
  - 從未發布的文章與所有 Working Draft 內容都不匯出。
  - 先在記憶體中產生完整 Snapshot，再寫入內容 repo；若與目前內容相比只有 `release_id`／`created_at` 不同，則不寫入也不 commit。
  - 只 stage `manifest.json`、`articles/`、`images/`；內容 repo 中的其他檔案不受影響。（BE-017 加入 `profile.json`。）
  - 前後端各自解析 Snapshot；後端測試以前端 parser（`frontend/scripts/check-snapshot.ts`）驗證匯出結果，作為兩邊的契約測試。
- **Consequences**：觸發 deploy workflow（PUB-004）尚未實作，需先建立 CMS 用的 GitHub token。（已由 BE-010 實作。）

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
- **Consequences**：Purge 只刪除資料庫資料；已部署的靜態網站在下一次部署前仍顯示舊內容（Baseline 7.1 的最終一致性）。Purge 與圖片 GC 的協調見 BE-007。依 PUB-005，到期清除只在 CMS 啟動時執行。
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
  - 引用是 Markdown parser 找出的圖片 token（行內或參考式），且 href 以 `images/` 開頭。code span、code block 內的文字、一般連結與 HTML `<img>` 都不算引用。後端（GC、Exporter）與前端（Snapshot 檢查）以同一份測試資料 `frontend/test-fixtures/image-refs.json` 確保規則一致。
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
- **2026-10-22 更新**（#29、#34）：
  - 登入節流改存在資料庫的 `sign_in_attempts`，依來源位址計算，在檢查密碼前先計數。連續 5 次失敗後以 30 秒起倍增、最長 15 分鐘的間隔封鎖，成功登入即清除。同時驗證密碼的請求最多 2 個，密碼最長 1024 字元。
  - session 改為登入後 3 天失效，閒置 1 天也失效；CMS 提供「登出所有裝置」。
  - `COOKIE_SECURE` 改由 `CMS_ENV` 決定預設值（`cloud` 預設開啟），開啟時 cookie 名稱為 `__Host-cms_session` 並加 HSTS。
- **Supersedes**：Baseline 12「CMS Auth」項目。

### BE-010：從 CMS 更新網站與部署追蹤

- **Status**：Accepted (delegated)
- **Context**：PUB-004（CMS 觸發 workflow）、PUB-005（失敗通知）、Baseline 9.1（DB 發布與部署成功是不同事件）、9.3。
- **Decision**：
  - CMS「網站發布 → 更新網站」依序：匯出 Snapshot 並 commit → push 到內容 repo → 以 `workflow_dispatch` 啟動 `deploy.yml`，輸入該 commit。
  - 每次匯出記為一筆 `releases`，並以 `release_articles` 記錄其中每篇文章的版本（供 Baseline 6.3 的版本清理使用）。
  - Release 狀態：`exported → pushed → dispatched → building → deployed`；也可能是 `superseded`（被較新的 commit 取代，部署步驟被跳過）或 `push_failed`／`dispatch_failed`／`failed`。
  - 以 workflow 的 `run-name: Deploy content <sha>` 找到對應的 run：只列出 release 建立時間前 5 分鐘（容許本機與 GitHub 的時鐘誤差）之後建立的 run，逐頁查詢，同名的 run 取最新的一個（重試會再啟動一次）；以 job 中 `Deploy to GitHub Pages` 步驟是否被跳過，判斷是已上線還是被取代。
  - 只有最新一筆 release 可以重試；重試會從失敗的那一步繼續。新 release 建立時，較舊且停在失敗狀態的 release 標記為 superseded。
  - 狀態在開啟「網站發布」頁面時向 GitHub 查詢；有未完成的 release 時每 15 秒更新一次。V1 不自動重試，失敗通知沿用 GitHub 的 Email（PUB-005）。
- **Consequences**：真實的 GitHub API 呼叫要等內容 repo、Pages 與 token 設定完成後才能驗證；目前以假的 GitHub API 與本機 bare repo 測試。
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

### BE-015：首次發布時間存在文章上

- **Status**：Confirmed（使用者 2026-10-20 確認為 bug）
- **Context**：BE-004 規定 `published_at` 為第一次發布的時間，但 Exporter 取的是「資料庫中仍存在的最舊版本」的時間。BE-011 刪除舊版本後，網站上的日期會往後移，下一次「更新網站」也會因此多出一個 release commit。
- **Decision**：
  - `articles.first_published_at` 在文章第一次 Publish 時寫入，之後不再改變。封存後重新發布（Republish）沿用原本的時間，因為 `doc_id` 不變，對讀者是同一篇文章。
  - Exporter 的 `published_at` 改讀這個欄位。
  - 資料庫 CHECK：`published`、`archived` 狀態的文章必須有 `first_published_at`。
  - Migration 0007 以每篇文章現存版本中最早的 `published_at` 回填。
- **Consequences**：已被 BE-011 刪掉第一版的文章，回填值是剩下最早版本的時間，無法還原真正的首次發布時間。
- **Supersedes**：無；修正 BE-004 的實作。

### BE-016：中斷的「更新網站」由下一次接續完成

- **Status**：Accepted (delegated)
- **Context**：BE-010 的流程先在內容 repo commit，再寫入 `releases`。git 與資料庫無法放在同一個交易，兩步之間失敗會留下兩種狀態：寫入但未 commit 的檔案，或資料庫沒有記錄的 release commit。Exporter 以目前的檔案判斷內容有沒有變，所以兩種情況下之後的匯出都認為「沒有變更」，在內容再次修改之前無法更新網站。
- **Decision**：
  - 每次匯出前，先把 `manifest.json`、`articles/`、`images/` 重設回 HEAD，丟棄中斷的匯出留下的檔案。有沒有變更一律與上一個 commit 比較。PUB-003 要求「全部成功後才 commit」，這裡不另用暫存目錄，而是由下一次匯出丟棄寫到一半的檔案來達成。
  - 匯出後，從 HEAD 讀出 release：commit 訊息為 `Release <id>` 且與 HEAD 的 `manifest.json` 中的 `release_id` 相同。資料庫還沒有這筆 release 時就建立它，然後照常 push 與啟動部署。內容 repo 的其他 commit（例如初始 commit）不會被當成 release。
  - 匯出期間被 Purge 的文章沒有資料列可以引用，不寫入 `release_articles`。
- **Consequences**：
  - 任何一步失敗後，再按一次「更新網站」即可完成；不需要手動整理內容 repo。
  - 從備份還原資料庫後，若資料庫內容與 HEAD 相同，HEAD 的 release 會被重新記錄並再部署一次相同內容。
- **Supersedes**：無；補足 BE-010 的失敗復原。

### BE-017：關於頁資料與 `profile.json` 匯出

- **Status**：Confirmed（使用者 2026-10-21 指定）
- **Context**：Addendum 04 FE-007 把關於頁改由 CMS 編輯。
- **Decision**：
  - 資料表 `profile` 只有一列（CHECK `id = 1`），欄位為 `revision`、`content`（JSONB）、`updated_at`。Migration 0008 建立時寫入原本 `profile.ts` 的內容，所以部署後網站不變。
  - `GET /api/profile` 回傳 `{revision, content, updated_at}`；`PUT /api/profile` 帶 `{revision, content}`，鎖定該列後比對 revision，成功時 revision +1，不符時回 409 與 `current_revision`（與 BE-002 相同的形狀）。和其他 `/api/*` 一樣需要登入。
  - API 以 Pydantic 驗證：字串去除前後空白；名字、連結名稱、經歷職稱、作品名稱、作品 tag 不可空白；網址必須是 `https://` 或 `mailto:` 開頭；長度上限為名字 100、標語與單行欄位 200、說明 2000、自我介紹 20000 字，每個清單最多 50 項，每個作品最多 20 個 tag。不合法回 422。
  - Exporter 在同一交易中讀取 profile，寫成 Snapshot 根目錄的 `profile.json`，鍵的順序固定。`profile.json` 加入 Snapshot 路徑（與 `manifest.json`、`articles/`、`images/` 一起比對內容、重設回 HEAD、stage），所以只修改介紹也會產生新的 release commit。
  - 自我介紹引用的 `images/` 圖片一起匯出，並算作圖片 GC 的有效引用（BE-007）；儲存時清除這些圖片的 `unreferenced_since`。
  - `schema_version` 維持 1：`profile.json` 是新增的檔案，前端在沒有它時使用預設內容，舊版前端則忽略它，兩個方向都相容。
  - 網站名稱與簡介（Addendum 04 FE-009）存在同一列的 `content.site`，形狀為 `{title, description}`：名稱不可空白、上限 100 字，簡介可空白、上限 300 字。此欄位之前存的資料沒有 `site` 鍵，讀取時由 Pydantic 預設為 `{title: "Personal Blog", description: ""}`，所以不需要 migration；下次儲存時才寫入資料庫。`PUT` 省略 `site` 時同樣存成預設值。`profile.json` 中 `site` 排在最後，其他鍵的順序不變。頁尾文字 `site.footer`（FE-010）可空白、上限 200 字，沒有此鍵的資料讀取時預設為空字串。
- **Consequences**：
  - 內容 repo 目前沒有 `profile.json`，所以此版本之後第一次「更新網站」即使文章沒有變更也會產生一個 release commit；內容與預設相同，網站不變。
  - 關於頁沒有版本或快照紀錄；儲存即覆蓋，上線的版本以內容 repo 的 commit 歷史為準。
- **Supersedes**：無；BE-004 的「只 stage `manifest.json`、`articles/`、`images/`」加上 `profile.json`。

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
- **Context**：Baseline 4.2 與 12 把 Taxonomy 的改名、合併、刪除與版本引用列為待決。
- **Decision**：
  - CMS 新增「分類管理」頁。`GET /api/taxa` 依種類（`topics`、`tags`、`series`）列出 slug、名稱、篇數（未在待刪除區、目前草稿使用它的文章數）與是否仍被任何草稿或保留中的 Published Version 引用。
  - 改名：`PUT /api/taxa/{kind}/{slug}`（`{"name"}`），與 BE-013 相同，所有引用處都顯示新名稱；slug 不能改。
  - 合併：`POST /api/taxa/{kind}/{slug}/merge`（`{"into"}`）把所有草稿與 Published Version 改指向目標，再刪除來源。和 BE-013 一樣，Topic／Tag／系列是誰屬於 Taxonomy 的身分，不屬於版本內容，所以已發布的文章也跟著改；`published_versions` 的不可變 trigger 改為只允許 `topic_id`、`series_id` 變動（migration 0010），Tag 透過 join table 的刪除與新增完成，不需要 UPDATE。同一篇已同時有來源與目標的 Tag 只留一筆。
  - 刪除：`DELETE /api/taxa/{kind}/{slug}` 只在沒有任何草稿或 Published Version 引用時成功，否則 409。
- **Consequences**：
  - 合併後來源的公開網址（例如 `/tags/js/`）在下次部署後消失；GitHub Pages 無法轉址，CMS 在合併前提示。
  - 仍開著、填著來源 slug 的編輯器下次自動儲存會重新建立它（BE-013 的 get-or-create），CMS 頁面上有說明。
  - Baseline 12 的 Taxonomy 待決事項由此決定，別名策略仍未提供。

### BE-020：雲端 CMS 只透過 Tailscale 存取

- **Status**：Confirmed（使用者 2026-10-22 決定）
- **Context**：CMS 原本只綁定 `127.0.0.1`，存取控制靠「只在作者的電腦上」。放到雲端主機後，登入頁會對網際網路公開，而 CMS 只有一組密碼。
- **Decision**：
  - 主機不開任何進站連接埠，管理只用 Tailscale SSH。
  - `tailscale serve` 以 `*.ts.net` 憑證提供 HTTPS，轉給只綁定 `127.0.0.1:8000` 的 CMS。
  - Tailscale ACL 只允許作者的帳號連到主機，並開啟裝置核准。主機的金鑰不到期，作者裝置的金鑰保留到期。
  - 不另外加 TOTP：通過核准的裝置是第一道驗證，密碼是第二道。
- **Consequences**：雲端的 CMS 設 `CMS_ENV=cloud`，`ALLOWED_HOSTS` 與 `CMS_ORIGIN` 用主機的 MagicDNS 名稱。步驟與裝置遺失時的處理見 `docs/cloud-access.md`。CMS 要開放給 tailnet 以外的網路時，必須重新評估第二道驗證。
- **Supersedes**：無。

### BE-021：本機與雲端用同一份程式碼，雲端 CMS 以 tag 部署

- **Status**：Confirmed（使用者 2026-10-22 決定）
- **Context**：CMS 先在作者電腦上執行，之後要能放到雲端主機。若為雲端開一條長期分支，每個修正都要做兩次，CI 與部署也都綁在 `main`。
- **Decision**：
  - 不開長期的雲端分支。能用同一種做法同時適用本機與雲端的，就不做成選項，例如定期維護是同一個指令 `python -m blog.maintenance`。
  - 只有真的不同的設定放進 `.env`，由 `backend/blog/config.py` 啟動時一次讀取並檢查。`CMS_ENV=local|cloud` 只決定預設值，每一項都能個別覆寫。
  - 合併到 `main` 只部署公開網站，不更新雲端 CMS。推送 `cms-v*` tag 時才部署 CMS：先備份，再執行 migration，最後更新程式。workflow 透過 Tailscale 的 GitHub Action 連到主機，主機仍不開進站連接埠（BE-020）。
- **Consequences**：fork 這個專案的人可以自己選本機或雲端。`cms-v*` 的部署 workflow 是 `.github/workflows/cms-deploy.yml`，預設停用，repo variable `CMS_DEPLOY_ENABLED=true` 才會執行；選哪個運算服務仍待決定（`docs/backlog.md`）。
- **Supersedes**：無。

### BE-022：本機與雲端共用發布流程

- **Status**：Confirmed（使用者 2026-10-22 決定）
- **Decision**：
  - 同一份 CMS 程式以環境設定選擇資料庫、網址、備份位置與憑證。本機預設與既有 clone 設定保留。
  - 新設定可選 Git Data API 發布，不需要內容 repo clone；認證可用 PAT 或 GitHub App。App 私鑰由執行環境提供，後端自動取得短效 token。
  - CMS 先持久化背景工作並回應 202。worker 匯出 Snapshot、準備 commit、保存內容與部署目的地後，才更新遠端分支。中斷後重試接續同一個 commit；其他 writer 改變 HEAD 時拒絕覆蓋。
  - 公開網站仍由 Actions 讀取 Snapshot 建置，不連回 CMS。`cms-v*` tag 的 CMS 主機部署獨立且預設停用。
- **Supersedes**：BE-004 中只能使用本機 clone 的限制，以及 BE-010 同步執行更新網站的介面行為。完整設定與切換見 `docs/portable-cms.md`。

### BE-023：文章 slug 與匯出過的網址

- **Status**：Confirmed（使用者 2026-10-26 指定）
- **Context**：Addendum 04 FE-015 讓文章可以用英文 slug 當網址。網址換過之後，舊網址要能轉到新網址，而且不能被另一篇文章拿去用。
- **Decision**：
  - `articles.slug` 可為空，格式是小寫英數字與單一 `-`，最多 80 字。`page` 是保留字，因為 `/posts/page/<n>/` 是文章列表的分頁。
  - `PUT /api/articles/{id}/slug` 設定或清除 slug，不建立新版本，下一次「更新網站」生效。格式不符回 422。被占用時回 409，並建議第一個可用的 `<slug>-2`、`-3`。`GET /api/slugs/{slug}` 只檢查、不寫入，給編輯器在欄位失焦時使用。
  - `article_urls`（migration 0016）記錄每篇文章實際匯出過的網址片段，包括 `doc_id` 與 slug，在建立 release 時寫入。migration 0016 替已經發布過的文章補上 `doc_id`。
  - 另一篇文章目前使用的 slug，以及另一篇文章匯出過的片段，都不能使用。只在 CMS 打錯、還沒匯出過的 slug 可以再給別篇用。
  - 匯出時，manifest 的每篇文章帶目前的 `slug`，以及 `redirect_from`，也就是 `article_urls` 裡目前網址以外的片段。沒有時兩個 key 都省略，`schema_version` 維持 1。
  - 永久刪除文章時，`article_urls` 隨文章一起刪除，用過的 slug 跟著釋出。
- **Consequences**：設定 slug 與匯出之間若在同一瞬間發生，兩篇文章可能在 manifest 中宣告同一個網址。前端 parser 會讓 build 失敗，不會部署錯的網站，改掉其中一個 slug 再「更新網站」即可。這個情況尚未加鎖處理，見 `docs/backlog.md`。
- **Supersedes**：無；實作 Addendum 04 FE-015。

### BE-024：CMS 的流量數據頁

- **Status**：Confirmed（使用者 2026-10-26 指定）
- **Context**：作者想看網站流量與搜尋表現，但已決定公開網站不放分析或追蹤程式（Baseline 3.3 的待選項目）。網站接上 Cloudflare 與 Google Search Console 之後，兩者都有可以從伺服器讀取的 API。
- **Decision**：
  - `backend/blog/analytics.py` 在伺服器端讀 Cloudflare GraphQL Analytics API 與 Google Search Console API，存進 `traffic_days`、`search_days` 與 `analytics_sources`（migration 0015）。公開網站完全不變。
  - 預設關閉。`backend/.env` 設定 `CLOUDFLARE_API_TOKEN` 與 `CLOUDFLARE_ZONE_ID`，或 `GSC_SITE_URL` 與 `GSC_CREDENTIALS_FILE`，才啟用對應的來源。Cloudflare token 只給 Analytics 唯讀權限。Google 用服務帳戶金鑰，放在 git 忽略的 `backend/secrets/`。
  - 沒有排程。開啟 CMS「流量數據」頁時，資料超過 6 小時就先更新一次。「立即更新」強制更新。重抓的日期整天覆蓋，所以重複更新不會重複計算。
  - 任何 HTTP 或格式錯誤都變成同一種錯誤，訊息遮掉 token，存起來給 CMS 顯示。一個來源失敗不影響另一個，API 仍回 200。
  - `GET /api/analytics?days=7|28|90` 回報表，`POST /api/analytics/sync` 更新資料。圖表是 CMS 內手寫的 inline SVG，不新增套件。
- **Consequences**：Cloudflare 第一次只能取得最近 30 天，90 天的圖要慢慢累積。Search Console 的資料約晚 2–3 天。設定步驟見 `docs/analytics.md`。實作時沒有用真實帳號的 API 回應測試。
- **Supersedes**：無；回答 Addendum 04 的 Open Question「流量分析服務的選型」。

## Known gaps

- ~~真實 GitHub API 與部署流程尚未在真實環境驗證。~~ 2026-10-20 作者以測試文章走完「發布 → 更新網站 → GitHub Pages」全流程。
