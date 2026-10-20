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

## Known gaps

- CMS API 尚無管理員身分驗證。上線至非本機環境前必須補上（Baseline 5.1、第 10 節第 7 條）。目前只綁定 `127.0.0.1`。
- Draft Snapshots、圖片上傳與圖片 GC，以及 Exporter 完成後觸發 deploy workflow，尚未實作。
