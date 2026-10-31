# Personal Blog — Addendum 01：Domain Model（Working Draft／Published Version）

> **這是設計紀錄，不是教學。** 記錄需求與架構決策及其理由；實際行為以程式碼為準。要建立自己的部落格請看 [`fork-and-deploy.md`](../fork-and-deploy.md)。

> **基線**：[Baseline v1.0](./personal-blog-system-spec-baseline-v1.0.md)
> **日期**：2026-10-20
> **範圍**：Working Draft 與 Published Version 的建模，以及 Auto Save／Publish 的併發控制。資料表與 API 的形狀見 Addendum 03。

## Confirmed Decisions

### ART-020：分離 WorkingDraft 與 PublishedVersion（方案 B）

- **Date**：2026-10-20
- **Status**：Confirmed
- **Context**：需滿足基線第 10 節的 Draft Isolation 與 Published Immutability。比較的兩個方案：

  ```text
  方案 A：統一 ArticleVersion        方案 B：分離
  Article                            Article
  └─ ArticleVersion                  ├─ WorkingDraft（Mutable）
     ├─ Draft                        └─ PublishedVersion（Immutable）
     ├─ Published V1
     └─ Published V2
  ```

  取捨的面向：領域責任、不可變性、交易一致性、Auto Save／Publish 競態，以及維護成本。
- **Decision**：
  - `WorkingDraft`：可變，每篇 Article 至多一份（1:1），包含 Title、Topic、Tags、Markdown。
  - `PublishedVersion`：不可變、只新增（append-only），每次 Publish 由 WorkingDraft 複製產生一筆，包含同一時點的 Title、Topic、Tags、Markdown。版本號是每篇文章內遞增的整數。
  - 文章目前的公開版本是它最新的 PublishedVersion，不另存參照。
  - 還原歷史版本：將選定 PublishedVersion 的內容與 Metadata 複製回 WorkingDraft（基線 6.1）。
- **Rationale**：
  - 不可變性由資料結構保證（對 PublishedVersion 禁止 UPDATE），不只依賴應用程式紀律。
  - 方案 A 若以「將草稿列改為已發布」實作 Publish，延遲的 Auto Save 會寫入已發布列；為避免此問題仍須複製，A 的「少表」優勢因此抵銷。
  - 「每篇一份草稿」可直接由 1:1 關聯保證；版本保留與圖片 GC 查詢只需查 PublishedVersion。
- **Consequences**：
  - Title／Topic／Markdown 等欄位在兩個實體中重複定義。
  - Tags 的多對多關聯分別存在於 WorkingDraft 與 PublishedVersion。
  - 資料表、trigger 與 constraint 見 Addendum 03 BE-002；Article 生命週期狀態機見 BE-005。

### ART-021：WorkingDraft 以 revision 做樂觀併發控制，Publish 於單一交易中完成

- **Date**：2026-10-20
- **Status**：Confirmed
- **Context**：基線 6.2、第 10 節第 4 條（Publish Consistency）。此問題與 A／B 的選擇無關，需獨立處理。檢驗情境：

  ```text
  14:00:00 Auto Save 開始
  14:00:01 管理員按 Publish
  14:00:02 Publish 開始處理
  14:00:03 Auto Save 完成
  ```

- **Decision**：
  1. WorkingDraft 持有單調遞增的 `revision`；每次成功寫入 +1。
  2. Auto Save 請求必須附帶其基於的 `revision`；與伺服器現值不符時拒絕寫入（HTTP 409），由前端重新載入草稿。
  3. Publish 在單一資料庫交易內完成：鎖定該 Article 的 WorkingDraft 列 → 確認請求的 `revision` 與現值一致 → 寫入使用者按下 Publish 當下的內容 → 複製為新 PublishedVersion → `revision` +1。
- **Effect on 檢驗情境**：14:00:00 開始、14:00:03 才到達的 Auto Save 帶著舊 `revision`，會被拒絕，不會覆蓋已確認發布的內容。
- **Consequences**：
  - CMS 前端處理 409（停止自動儲存、提示重新載入，BE-006）。
  - Draft Snapshot 記錄它來源的 `revision`（BE-008）。
