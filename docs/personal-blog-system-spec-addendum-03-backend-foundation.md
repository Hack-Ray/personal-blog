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

## Known gaps

- CMS API 尚無管理員身分驗證。上線至非本機環境前必須補上（Baseline 5.1、第 10 節第 7 條）。目前只綁定 `127.0.0.1`。
- Article Lifecycle（Archive、Pending Deletion、Restore、永久刪除）、Draft Snapshots、圖片上傳與 Content Exporter 尚未實作。
