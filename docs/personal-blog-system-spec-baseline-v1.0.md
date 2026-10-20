# Personal Blog — 系統需求與架構設計基線規格書

> **版本**：Baseline v1.0
> **決策截止日**：2026-10-11
> **專案**：`Hack-Ray/personal-blog`
> **文件性質**：已確認需求／架構決策的累積基線（Decision Baseline），不是已完成實作的宣告
> **討論狀態**：本階段暫停；下次從「Domain Modeling：Working Draft 與 Published Version 如何建模」接續

---

## 0. 本文件使用原則

1. **「已確認」**表示在截至本文件日期的共同設計討論中，使用者已明確選定的業務規則或架構方向。
2. **「方向已定、細節未定」**表示選擇的產品／技術方向已明確，但具體技術實作尚待討論；不得視為詳細設計已完成。
3. **「未決定」**的項目只作待辦與決策議題紀錄，不代表預設採用任何選項。
4. 本文件記錄決策及其約束，不自行導出未經討論的 ORM、資料表結構、API 端點、部署廠商或程式碼分層。
5. 後續文件採增量方式：從本文件之後新確認的決策，寫入後續續篇或 Change Log；不再重製本份已記錄的規格。如需完整整合版，須另行明確提出。
6. 本文件中的範例 ID、網址與流程是示意，不代表已存在的正式資料或部署環境。

## 1. 專案定位與目標

### 1.1 專案目的（已確認）

- 建立個人技術部落格、作品集與專業展示網站。
- 發布技術文章，長期累積工程實踐與學習成果。
- 透過自建 CMS／後端實際練習 FastAPI、資料模型、系統設計及可靠性設計。
- 兼顧個人使用、有限流量及低維護成本；不為低機率需求過度設計。

### 1.2 非功能性限制（已確認）

| 項目 | 規格 |
|---|---|
| 預算 | 月度目標約 **NT$500**。 |
| 流量情境 | 初期預估流量不高，非高併發系統。 |
| 成本優先級 | 盡量減少長期常駐後端、無必要的基礎設施與維護負擔。 |
| 公開內容可用性 | 訪客瀏覽公開文章不應依賴 FastAPI 即時在線；後端停機不應影響已部署的靜態文章閱讀。 |
| 一致性模型 | 內容發布與網站部署允許 **最終一致性（Eventual Consistency）**，但需能區別資料庫期望狀態與目前線上實際狀態。 |
| 技術取捨 | 優先採用成熟的外部服務處理非核心功能，例如留言與網站流量分析。 |

## 2. 系統整體架構

### 2.1 已確認的主要構成

```text
                         作者／管理員
                              │
                              ▼
                     CMS（文章編輯）
                              │
                              ▼
                     FastAPI Backend
                              │
                              ▼
                 PostgreSQL（V1 規劃）
                   ├─ 文章／版本／草稿
                   └─ 圖片索引與內容
                              │
                       發布／部署事件
                              │
                              ▼
                       GitHub Actions
                   ├─ 讀取發布資料
                   ├─ 產生靜態頁面
                   └─ 匯出文章圖片
                              │
                              ▼
             GitHub Pages（Next.js Static Export）
                              │
                              ▼
                       公開網站訪客
                              │
                  ├─ giscus 留言互動
                  └─ 第三方網站流量分析
```

此圖為邏輯架構示意；例如 GitHub Actions 具體如何安全存取後端、後端實際部署在哪裡、CMS 前後端同源或分離，均尚未定案。

### 2.2 前端與公開網站（已確認）

- 前端採用 Next.js + TypeScript。
- 公開網站採用 Static Site Generation（SSG）；使用 Next.js `output: 'export'` 產生靜態檔案。
- 由 GitHub Actions 建置並部署至 GitHub Pages。
- 不在 V1 使用持續運作的 Next.js Server、SSR 或 ISR。
- 使用 GitHub Pages 專案網站路徑時，須考慮 `basePath: '/personal-blog'`；自訂網域屬未來可能調整項目。
- 公開頁面以預先產生 HTML 為主；只有必要互動功能在瀏覽器端執行。
- V1 每次發布採全站完整建置／部署（Full Build）。
- 未來期望提升增量更新效率，但 GitHub Pages 的網站部署仍以整份站點產物為單位；不可將「增量建置」與「只部署單頁」混為一談。

### 2.3 後端（已確認的方向）

- 後端主要使用 Python FastAPI。
- 核心責任是文章 CMS、草稿、發布版本、媒體管理及發布流程的服務端操作。
- 公開文章閱讀由已部署的靜態網站服務，不要求訪客每次閱讀都查詢 FastAPI。
- PostgreSQL 是 V1 的資料儲存規劃方向；設計需避免將公開永久識別碼綁死於 PostgreSQL 的內部主鍵。
- 後端部署平台、常駐方式、ORM、遷移工具與具體專案分層：未決定。

## 3. 公開網站功能範圍

### 3.1 內容與導覽（已確認）

- 首頁、文章列表、文章閱讀頁、Topic／Tag 瀏覽與篩選、個人介紹／作品集內容。
- 文章可依發表日期進行新到舊／舊到新排序。
- 支援文章關鍵字搜尋；搜尋索引放在靜態站或由後端 API 提供，尚未決定。
- 作品集／個人介紹包含經歷、成果或專案展示，以及 GitHub、LinkedIn、Email 等對外連結；內容由 CMS 或靜態程式碼管理尚未決定。

### 3.2 已簡化／移除的公開功能（已確認）

- 不公開展示文章瀏覽次數。
- 不提供對訪客公開的文章人氣排序。
- 留言與反應不自行開發一套帳號、留言、按讚系統，而是交由 giscus。
- 一般讀者不需要建立本站帳號才能閱讀文章；參與 giscus 的 GitHub Discussions 互動則依 GitHub 的登入要求。

### 3.3 第三方服務（已確認的範圍／尚未定的供應商）

- 留言／反應：giscus，底層使用 GitHub Discussions。
- 網站流量分析：採第三方分析服務；資料供管理員檢視，例如最熱門文章與流量，不在公開網站顯示瀏覽數。Cloudflare Web Analytics 是候選方案，尚未正式定案。
- 廣告：未來可能放置 Google AdSense，原則上靠頁面下方、不干擾閱讀；不是 V1 必備交付功能。
- giscus 與文章的對應應利用不隨標題改動的文章身分；確切 giscus mapping 設定仍待實作時確認。

## 4. Article Identity 與分類規則

### 4.1 文章識別（已確認）

| 欄位／概念 | 決策 |
|---|---|
| Article Internal ID | 資料庫內部主鍵，供內部資料關聯。 |
| `doc_id` | 與內部主鍵**獨立**的公開永久識別碼。 |
| 識別碼格式 | **ULID，26 字元**。 |
| 公開路由 | `/posts/{docId}`。 |
| 產生時機 | 建立 Article 時配置。 |
| 可變性 | `doc_id` 建立後不可修改。 |
| 重複使用 | 刪除文章後亦不得將既有 `doc_id` 分配給其他文章。 |
| 版本關係 | 同一篇文章所有草稿／正式版本、封存與重新發布都保留同一 `doc_id`。 |

使用者選擇 ULID 的主要理由：網址相對短，並避免把公開識別碼的語意耦合到特定資料庫。注意 UUID 也具跨資料庫能力，ULID 不是資料庫可攜性的唯一選項。

URL 示意：

```text
/posts/01K7M4Y7P65BDCF8AHRTQY7ZQF
```

- Title 更名時，公開 URL 不因標題改動而改變。
- 原本規劃的可變 Slug 與 Slug Redirect History 不再是現行公開文章路由需求。
- `doc_id` 是公開識別碼，不是授權或私密存取憑證；草稿／未公開文章不得因 ID 難猜而視為受保護。
- ULID 的大小寫慣例、產生套件與資料庫欄位型態等屬實作細節，尚未確認。

### 4.2 Topic 與 Tags（已確認）

- 每篇文章恰有一個 Primary Topic；Topic 對 Article 是一對多關係。
- 每篇文章可有 0～N 個 Tags；Article 與 Tag 為多對多關係。
- 建立 Working Draft 時，Topic 即為必填；不能先建立無 Topic 的文章草稿。
- Tags 不必填。
- Title、Topic、Tags 與 Markdown 共同納入文章版本管理；草稿變更不直接更動對外已發布的 Metadata。

Topic／Tag 的管理介面、命名、改名、合併、刪除及別名策略：未決定。

## 5. CMS 與編輯體驗

### 5.1 管理功能（已確認）

- 自建 CMS，支援文章建立、讀取、編輯、刪除、發布與下架等完整生命週期。
- 編輯器以 Markdown 為內容形式，體驗參考 HackMD，可同時編輯與預覽（例如分割畫面）。
- 支援標題及相關 Metadata 編修。
- 支援 Auto Save（自動儲存 Working Draft）；Auto Save 不觸發網站重新部署。
- 已發布文章再次編輯時，修改應存於 Working Draft，不應即時覆蓋線上版本。
- CMS 管理員必須有身分驗證及適當授權；具體登入方案／Session／Token 設計未決定。

### 5.2 內文圖片上傳（已確認）

- 只能透過文章 Markdown 編輯器的編輯流程上傳圖片，例如選取圖片、拖曳檔案、貼上截圖。
- 上傳後在 Markdown 中插入引用，並可於編輯器中預覽。
- V1 不建立獨立的媒體庫上傳工作流程／相簿管理產品功能。
- 編輯階段的圖片預覽可由 FastAPI 提供；公開網站上的文章圖片，需在發布建置時匯出成靜態資產。

## 6. Article Content Versioning

### 6.1 草稿／發布資料隔離（已確認）

- Working Draft 為可修改的編輯工作狀態。
- Published Version 為已定稿的不可變快照。
- 文章可有多個 Published Versions；編輯舊文章時仍保有目前公開版本。
- 不論 Title、Topic、Tags 或 Markdown，編輯中的內容均不得因 Auto Save 直接影響已部署的公開文章。
- 發布須將一組一致的內容與 Metadata 保存為新 Published Version；隨後才進入建置／部署流程。
- 歷史版本還原方式：將選定版本的內容與 Metadata 複製至 Working Draft；重新發布時建立新版本，不修改舊版本。

以下只是概念結構，尚不代表領域實體或資料表已定案：

```text
Article (stable doc_id)
├─ Working Draft (mutable)
├─ Draft Snapshots
└─ Published Versions (immutable)
   ├─ Version N-2
   ├─ Version N-1
   └─ Version N
```

### 6.2 Draft Snapshot（已確認）

- 除了 Auto Save 的當前草稿外，另外保留 Draft Snapshots，用於編輯過程中的復原。
- Snapshot 儲存的是完整 Markdown 文字快照，不是文字 Diff。
- 觸發條件考慮實際內容差異與經過時間／最大間隔，避免每次按鍵都建立 Snapshot；具體閾值尚未決定。
- 當新 Published Version 已成功、持久地寫入資料庫，即可移除該次編輯週期的 Draft Snapshots，不必等待 GitHub Pages 部署成功。
- 需避免延遲到達的 Auto Save 覆蓋使用者已確認發布的內容；版本號／併發控制的具體方案尚未決定。

### 6.3 Published Version Retention（已確認）

- 一般情況下保留最近三個 Published Versions。
- 新版發布後，不可立即清除舊版；應等新版本對應的靜態網站成功部署後，才進行安全的舊版本清理。
- 如部署失敗，或線上／待部署中的資產仍依賴某個較舊版本，允許暫時保留超過三版以避免遺失可用資料。
- 版本清理必須與文章圖片的引用保護協調。

## 7. Article Lifecycle 與公開網站行為

### 7.1 業務狀態（已確認）

| 狀態 | CMS／資料狀態 | 正式部署完成後的公開 URL 行為 |
|---|---|---|
| Draft | 文章尚未發布，資料僅於管理端 | **404** |
| Published | 有目前的公開發布版本 | 顯示對應文章內容 |
| Archived | 下架、保留文章與版本資料 | 原 `/posts/{docId}` 顯示固定的**「文章已封存」提示頁** |
| Pending Deletion | 軟刪除等待期，保留復原所需資料 | **404** |
| Permanently Deleted | 文章已永久清理 | **404**；不再重新分配 DocID |

- 上表是部署成功後的期望結果。資料庫狀態變更到靜態部署完成前，公開網站可能仍顯示前一版內容。
- 封存頁與一般文章頁不同；封存頁的搜尋引擎 noindex 與 Sitemap 移除是目前建議的 SEO 處置，具體技術操作尚待實作設計。
- Pending Deletion 的文章必須從公開文章列表、Topic／Tag 頁、搜尋結果及 Sitemap 排除，並於部署後使原網址回傳 404。

### 7.2 Unpublish / Archive（已確認）

- 文章下架時不立即刪除內文或版本資料。
- 保留相同 `doc_id` 與公開網址。
- 下架後公開網址顯示固定「此文章已封存」訊息，而非文章原文。
- 如未來重新發布，沿用該 Article 的原 `doc_id`。

### 7.3 Delete / Retention / Restore（已確認）

- 刪除文章首先進入 Pending Deletion（Soft Delete），不是立即物理刪除。
- 自刪除起提供 30 天復原期限，用途是保護誤刪，即使平時不預期頻繁復原。
- 管理員可在 CMS 待刪除區復原文章。
- 管理員也可主動永久清除，不必等待滿 30 天。
- 超過 30 天進行永久刪除／清理。
- Pending Deletion 期間須保留文章、相關版本及復原所必需的圖片，不得被每週圖片清理誤刪。
- 需保護尚在線上或正在部署中引用的資料，避免刪除造成既有公開資產破損。
- 恢復後仍沿用同一 `doc_id`；恢復到哪個編輯／公開狀態的細部規則尚待領域模型確認。

### 7.4 Republish（已確認）

- 下架後重新發布，沿用原 `doc_id`。
- 重新發布可產生新的不可變 Published Version。
- 文章對應的公開 URL 長期固定，以減少失效外連、搜尋索引與 giscus 討論關聯變動。

## 8. 圖片儲存、發布與垃圾回收

### 8.1 V1 圖片儲存（已確認的方向）

- V1 圖片先存於 PostgreSQL，而非一開始即使用 Object Storage。
- 將圖片 metadata／索引（概念上 ImageIndex）與二進位內容（概念上 ImageData，PostgreSQL BYTEA）區分管理。
- 此為資料責任的初步劃分，不等同於已確定資料表結構。
- 長期可考慮將圖片 Bytes 移至 Object Storage；在目前 V1 不強制實作遷移。
- 不原地覆寫可能被 Published Version 引用的圖片內容；更換圖片應以新的圖片資源身分避免歷史版本損壞。

### 8.2 靜態輸出（已確認）

- 每次需要發布的新網站 Build，GitHub Actions 依文章引用關係取得該版本圖片。
- 將 Markdown 所用圖片輸出成 GitHub Pages 可直接服務的靜態圖片檔案。
- 訪客閱讀已發布文章時，圖片不需要透過 FastAPI 或 PostgreSQL 即時提供。

### 8.3 Image Garbage Collection（已確認）

| 項目 | 規格 |
|---|---|
| 執行頻率 | **每週五**一次。 |
| 刪除前寬限期 | 圖片須持續**至少七天沒有任何有效引用**。 |
| 從未被引用的上傳 | 至少經過上傳後七天，方可考慮清理。 |
| 受保護引用 | Working Draft、仍保留的 Draft Snapshots、保留中的 Published Versions、實際線上部署，以及待部署／進行中的 Build。 |
| 待刪除文章 | 30 天復原期限內所需的圖片必須保留。 |
| 版本與部署協調 | 需考慮發布、Auto Save、圖片引用變動與清理工作競態；不能僅靠某一瞬間的引用計數即刪除。 |

- 七天計時從最後一個有效引用消失後開始，而不是從圖片上傳那天起一律計算。
- 如何記錄引用、清理鎖定及失敗重試：未決定。

## 9. Publish、CI/CD 與部署一致性

### 9.1 已確認的發布語意

1. 管理員在 CMS 明確執行 Publish。
2. 後端保存一份新的不可變 Published Version（Title、Topic、Tags、Markdown 一致）。
3. 資料庫發布成功與網站部署成功是兩個不同事件；不能混為單一狀態。
4. 將需要更新的網站交由 GitHub Actions Build，輸出文章／列表／分類等受影響的靜態頁面及圖片；V1 實作為全站 Build。
5. 部署到 GitHub Pages 後才表示新版本已真正在線上可讀。
6. 靜態網站最終必須趨近最新期望發布狀態（Latest State Wins）。

### 9.2 併發發布與過時版本（已確認）

- 新發布版本出現時，取消已過時、尚未開始的重試工作。
- 已經運行中的 Build 不必強制取消，可讓它完成。
- 部署前須檢查 Build 產物是否已被更新的期望狀態取代；過時產物應略過部署，並確保後續有更新版本的 Build。
- 部署應避免互相覆蓋；部署互斥／序列化是既有一致性要求。
- 檢查「最新版本」到實際部署之間仍可能有 Race Condition，具體原子性／鎖／序列號協定尚待設計。
- 不強制要求針對每一個 Build 儲存永久、完整、不可變的全站快照；但需有足夠版本／Manifest／狀態記錄辨識實際部署的是什麼。

### 9.3 失敗處理（方向已定、細節未定）

- 需要監控 GitHub Actions Build／Deploy 的成功、失敗、逾時等結果。
- 失敗應有有限次數重試機制；先前討論的**「最多約三次」仍為暫定值**，尚未確定計數、間隔與可重試錯誤分類。
- 持續失敗需以 Email 通知管理員。
- 由 GitHub Actions Webhook、Polling 或其他方式追蹤結果，尚未決定。
- Durable Queue／Outbox、Trigger API、重試排程、憑證管理等實作尚未定案。
- 即使網站部署失敗，資料庫中已成功持久化的 Published Version 不因此自動消失。

## 10. 資料一致性、安全與清理的不變條件

以下是由已確認需求直接形成的設計約束；具體實作仍待後續設計。

1. **Identity**：一篇 Article 對應一個永久且不重複使用的 ULID `doc_id`；不等同於資料庫內部主鍵。
2. **Draft Isolation**：Working Draft 的 Auto Save、Title／Topic／Tags／Markdown 修改，不得直接修改既有 Published Version。
3. **Published Immutability**：發布後不可原地改寫 Published Version；還原歷史文章須建立新的編輯／發布過程。
4. **Publish Consistency**：建立的 Published Version 必須是同一個一致時點的內容與 Metadata；須防止 Auto Save 與 Publish 併發造成意外覆蓋。
5. **Deployment Awareness**：不能因 DB 已更新便宣稱公開網站已更新；必須追蹤線上部署狀態。
6. **Safe Retention**：清除舊版、待刪除文章或圖片之前，需確認不會破壞線上／待部署內容，且滿足必要的復原保護。
7. **Public Access Boundary**：公開讀者只能讀取已部署公開內容；CMS 編輯／草稿／媒體預覽與管理操作須適當授權。
8. **Low Runtime Dependency**：公開閱讀不應依賴即時 FastAPI API 成功回應。

## 11. 已確認決策索引（本輪 Article 討論）

> 以下 `ART-*` 編號沿用本輪討論中已使用的決策代號；其他章節決策以本文件內容為準，不額外宣稱存在既有核准編號。

| 決策編號 | 決策內容 |
|---|---|
| ART-009 | 文章 Title、Topic、Tags 等 Metadata 與 Markdown 一同進行草稿／發布版本管理。 |
| ART-010 | 文章公開 `doc_id` 與內部資料庫 PK 分離。 |
| ART-011 | 公開 `doc_id` 選擇 ULID，路由為 `/posts/{docId}`。 |
| ART-012 | Unpublish 後原網址顯示固定「文章已封存」頁面。 |
| ART-013 | Delete 先進入 Soft Delete／Pending Deletion。 |
| ART-014 | 待刪除保留 30 天。 |
| ART-015 | 管理員可主動永久清除。 |
| ART-016 | Republish 保留原有 ULID DocID。 |
| ART-017 | Pending Deletion 保留可復原能力。 |
| ART-018 | Pending Deletion 的公開文章 URL 顯示 HTTP 404。 |
| ART-019 | 再次確認 30 天 Soft Delete 為防止誤刪，沒有取消復原機制。 |

## 12. 尚未決定：不得視為已確認規格

| 領域 | 待決事項 |
|---|---|
| **Domain Modeling（下一題）** | Working Draft／Published Version 使用**統一 `ArticleVersion`（方案 A）**，還是**分離 `WorkingDraft` 與 `PublishedVersion`（方案 B）**？如何保護不可變性及處理 Auto Save／Publish 競態？ |
| Domain Relationships | Aggregate Boundary、Article／Version 的持久化關係、Transaction Boundary、具體 State Machine。 |
| Database | PostgreSQL 詳細 Schema、關聯、Index、Constraint、Migration；ORM 是否採 SQLAlchemy 等。 |
| Backend | FastAPI 內部模組分層、API 規格、執行／部署平台、是否常駐、監控方案。 |
| CMS Auth | 管理員登入身分驗證、Session／Token、權限及私有媒體預覽控制。 |
| Taxonomy | Topic／Tag 管理、重命名、合併、版本引用的精確處理方式。 |
| Article Search | 純靜態前端索引、Build Time 索引或後端搜尋 API 等。 |
| Portfolio | 個人介紹／作品集使用 CMS 維護或程式碼／靜態內容維護。 |
| Draft Snapshot | 間隔、變更閾值、最大筆數、如何避免同時存檔覆蓋。 |
| Image Management | 引用追蹤的資料模型、GC 排程器、併發保護、Object Storage 的遷移時機。 |
| CI/CD | Build Trigger、Webhooks／Polling、重試參數、Email 服務、Manifest、部署鎖、Stale Check 原子性。 |
| Analytics | 第三方分析產品的最終選型與資料政策。 |
| SEO／404 | 封存頁 `noindex` 的具體作法、GitHub Pages 的 404 與 URL 處理、sitemap 的生成策略。 |
| 恢復 | Pending Deletion Restore 時回到先前 Draft／Archived／Published 狀態的詳細規則及部署時序。 |
| ULID | 實際產生套件、大小寫格式、欄位型別及資料驗證手段。 |
| 未來優化 | Incremental Build／前端資料更新與 GitHub Pages 全站部署的協作方式。 |

特別註明：先前討論過的 SQLAlchemy、Alembic、Pydantic、uv、pytest、HTTPX、Redis、AWS EC2、Docker、特定架構分層、Cloudflare Web Analytics 等，除非已在以上正文標記為確定內容，均不能自動視為已選定的 V1 設計。

## 13. 下次討論起點（本文件不替使用者決定）

下一個問題：Working Draft 與 Published Version 的 Domain Model。

**方案 A：統一 ArticleVersion**

```text
Article
└─ ArticleVersion
   ├─ Draft
   ├─ Published V1
   └─ Published V2
```

**方案 B：分離 WorkingDraft 與 PublishedVersion**

```text
Article
├─ WorkingDraft（Mutable）
└─ PublishedVersion（Immutable）
```

需要以以下情境檢驗選擇：

```text
14:00:00 Auto Save 開始
14:00:01 管理員按 Publish
14:00:02 Publish 開始處理
14:00:03 Auto Save 完成
```

待回答的唯一主問題：選擇 A 還是 B？理由是什麼？如何從領域責任、不可變性、交易一致性、Auto Save／Publish 競態，以及維護成本做取捨？

> **不可在下次直接視為已選 B；前次助理傾向 B 不代表使用者已接受。**

## 14. 後續文件續寫規則

- 本文件名稱固定視為 Baseline v1.0（截至 2026-10-11）。
- 後續每次階段性整理請另建立，例如：
  - `personal-blog-system-spec-addendum-01-domain-model.md`
  - `personal-blog-system-spec-addendum-02-<topic>.md`
- 續篇只寫本基線之後新確認的決策、必要的理由／後果、與基線項目有衝突時的明確修訂（Supersedes），不重複貼上基線全部章節。
- 建議每項新增決策保留：Decision ID、Date、Status、Context、Decision、Consequences、Supersedes (if any)。
- 未經使用者確認的設計選項列為 Open Questions，不可混入 Confirmed Decisions。
- 需要完整規格單一檔案時，僅在使用者明確要求整合後，才將基線與續篇合併。

---

本基線到此截止。下一次對話從第 13 節開始，不重複本文件已確認內容。
