# Personal Blog — Addendum 01：Domain Model（Working Draft／Published Version）

> **這是設計紀錄，不是教學。** 記錄開發時的需求與架構決策及其理由；實際行為以程式碼為準。要建立自己的部落格請看 [`fork-and-deploy.md`](../fork-and-deploy.md)。

> **基線**：[Baseline v1.0](./personal-blog-system-spec-baseline-v1.0.md)（截至 2026-10-11）
> **日期**：2026-10-20
> **範圍**：回答基線第 13 節的主問題；只記錄本次新確認的決策，不重複基線內容。

## Confirmed Decisions

### ART-020：分離 WorkingDraft 與 PublishedVersion（方案 B）

- **Date**：2026-10-20
- **Status**：Confirmed
- **Context**：基線第 12、13 節。需在方案 A（統一 `ArticleVersion`）與方案 B（分離 `WorkingDraft`／`PublishedVersion`）之間選擇，並滿足基線第 10 節的 Draft Isolation 與 Published Immutability。
- **Decision**：
  - `WorkingDraft`：可變，每篇 Article 至多一份（1:1），包含 Title、Topic、Tags、Markdown。
  - `PublishedVersion`：不可變、只新增（append-only），每次 Publish 由 WorkingDraft 複製產生一筆，包含同一時點的 Title、Topic、Tags、Markdown。
  - 還原歷史版本：將選定 PublishedVersion 的內容與 Metadata 複製回 WorkingDraft（與基線 6.1 一致）。
- **Rationale**：
  - 不可變性可由資料結構保證（例如對 PublishedVersion 禁止 UPDATE），不只依賴應用程式紀律。
  - 方案 A 若以「將草稿列改為已發布」實作 Publish，延遲的 Auto Save 會寫入已發布列；為避免此問題仍須複製，A 的「少表」優勢因此抵銷。
  - 「每篇一份草稿」可直接由 1:1 關聯保證；版本保留與圖片 GC 查詢只需查 PublishedVersion。
- **Consequences**：
  - Title／Topic／Markdown 等欄位在兩個實體中重複定義。
  - Tags 的多對多關聯需分別存在於 WorkingDraft 與 PublishedVersion。
- **Supersedes**：無。

### ART-021：WorkingDraft 以 revision 做樂觀併發控制，Publish 於單一交易中完成

- **Date**：2026-10-20
- **Status**：Confirmed
- **Context**：基線 6.2、第 10 節第 4 條（Publish Consistency），以及第 13 節的 Auto Save／Publish 競態情境。此問題與 A／B 的選擇無關，需獨立處理。
- **Decision**：
  1. WorkingDraft 持有單調遞增的 `revision`；每次成功寫入 +1。
  2. Auto Save 請求必須附帶其基於的 `revision`；與伺服器現值不符時拒絕寫入（例如 HTTP 409），由前端重新載入草稿。
  3. Publish 在單一資料庫交易內完成：鎖定該 Article 的 WorkingDraft 列 → 確認請求的 `revision` 與現值一致（或寫入使用者按下 Publish 當下的內容）→ 複製為新 PublishedVersion → `revision` +1。
- **Effect on 基線情境**：14:00:00 開始、14:00:03 才到達的 Auto Save 帶著舊 `revision`，會被拒絕，不會覆蓋已確認發布的內容。
- **Consequences**：
  - CMS 前端需處理 409（重新載入／提示使用者）。
  - 交易與鎖的具體實作方式（例如 `SELECT … FOR UPDATE`）隨 ORM／Schema 設計一同決定。
- **Supersedes**：無；補充基線 6.2「版本號／併發控制的具體方案尚未決定」。

## Open Questions（尚未確認）

- Draft Snapshot 與 WorkingDraft `revision` 的關係（Snapshot 是否記錄來源 revision）。
- PublishedVersion 的版本序號格式（每篇文章內遞增整數或其他）。
- Article 目前公開版本的指向方式（Article 上的 current published 參照，或由最新 PublishedVersion 推導）。
- Aggregate Boundary 與 Article 生命週期 State Machine 的具體定義。
- 詳細 Schema、Index、Constraint 與 Migration。
