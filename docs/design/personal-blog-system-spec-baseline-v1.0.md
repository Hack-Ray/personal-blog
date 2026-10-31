# Personal Blog — 系統需求與架構設計基線規格書

> **這是設計紀錄，不是教學。** 記錄需求與架構決策及其理由；實際行為以程式碼為準。要建立自己的部落格請看 [`fork-and-deploy.md`](../fork-and-deploy.md)。

> **版本**：Baseline v1.0
> **專案**：`Hack-Ray/personal-blog`
> **文件性質**：需求與最上層架構決策。細部決策在 Addendum 01–04。所有內容描述目前的系統。

---

## 0. 本文件使用原則

1. **「已確認」**表示使用者已明確選定的業務規則或架構方向。
2. 本文件記錄需求、不變條件與最上層的架構。細部決策（資料表、API、部署方式）在 [Addendum 01](./personal-blog-system-spec-addendum-01-domain-model.md)、[02](./personal-blog-system-spec-addendum-02-publishing-pipeline.md)、[03](./personal-blog-system-spec-addendum-03-backend-foundation.md)、[04](./personal-blog-system-spec-addendum-04-public-site.md)，以決策 ID 引用。
3. 文件維護規則見第 13 節。
4. 本文件中的範例 ID、網址與流程是示意，不代表已存在的正式資料或部署環境。

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

### 2.1 主要構成（已確認）

```text
                         作者／管理員
                              │
                              ▼
                 CMS（React SPA，與 API 同源）
                              │
                              ▼
                     FastAPI Backend
                              │
                              ▼
                       PostgreSQL 16
                   ├─ 文章／版本／草稿
                   └─ 圖片索引與內容
                              │
                 「更新網站」：匯出 Content Snapshot
                              │
                              ▼
                 private 內容 repo（Snapshot）
                              │
                    workflow_dispatch 部署
                              │
                              ▼
                       GitHub Actions
                   ├─ 讀取 Snapshot 並驗證
                   └─ Next.js Static Export
                              │
                              ▼
                        GitHub Pages
                              │
                              ▼
                       公開網站訪客
                              │
                  └─ giscus 留言互動
```

- GitHub Actions 不連 FastAPI 或 PostgreSQL，只讀內容 repo 的 Snapshot（PUB-001、PUB-002）。
- CMS 介面由 FastAPI 在 `/admin/` 提供，與 API 同源（BE-006）。
- 作者的 CMS 跑在 AWS EC2，經 Cloudflare Tunnel 與 Access 連線（BE-026、BE-027）。Fork 預設在自己的電腦執行，也可以放在 Tailscale 主機（BE-020、BE-021）。

### 2.2 前端與公開網站（已確認）

- 前端採用 Next.js + TypeScript。
- 公開網站採用 Static Site Generation（SSG）；使用 Next.js `output: 'export'` 產生靜態檔案。
- 由 GitHub Actions 建置並部署至 GitHub Pages。
- 不使用持續運作的 Next.js Server、SSR 或 ISR。
- 網站的 origin 與 basePath 由部署環境提供，Pages 專案網址與自訂網域都不需要改程式（FE-014）。
- 公開頁面以預先產生 HTML 為主；只有必要互動功能在瀏覽器端執行。
- 每次發布採全站完整建置／部署（Full Build）。
- GitHub Pages 的網站部署以整份站點產物為單位；不可將「增量建置」與「只部署單頁」混為一談。

### 2.3 後端（已確認）

- 後端使用 Python FastAPI，資料存在 PostgreSQL（BE-001）。
- 核心責任是文章 CMS、草稿、發布版本、媒體管理及發布流程的服務端操作。
- 公開文章閱讀由已部署的靜態網站服務，不要求訪客每次閱讀都查詢 FastAPI。
- 公開永久識別碼不綁 PostgreSQL 的內部主鍵（第 4.1 節）。
- 本機與雲端使用同一份程式，差異只在環境設定（BE-021、BE-022）。

## 3. 公開網站功能範圍

### 3.1 內容與導覽（已確認）

- 首頁、文章列表、文章閱讀頁、Topic／Tag 瀏覽與篩選、個人介紹／作品集內容。
- 歸檔頁依發表日期列出文章，可切換新到舊／舊到新（FE-011）。
- 文章關鍵字搜尋在瀏覽器端進行，索引在 build 時產生（FE-002）。
- 作品集／個人介紹包含經歷、成果或專案展示，以及 GitHub、LinkedIn、Email 等對外連結，由 CMS 編輯（FE-007）。

### 3.2 已簡化／移除的公開功能（已確認）

- 不公開展示文章瀏覽次數。
- 不提供對訪客公開的文章人氣排序。
- 留言與反應不自行開發一套帳號、留言、按讚系統，而是交由 giscus。
- 一般讀者不需要建立本站帳號才能閱讀文章；參與 giscus 的 GitHub Discussions 互動則依 GitHub 的登入要求。

### 3.3 第三方服務（已確認）

- 留言／反應：giscus，底層使用 GitHub Discussions，以 `doc_id` 對應討論串（FE-006）。
- 網站流量分析：公開網站不放分析或追蹤程式。CMS 在伺服器端讀 Cloudflare 與 Google Search Console 的 API，只給管理員看（BE-024）。
- 廣告：未來可能放置 Google AdSense，原則上靠頁面下方、不干擾閱讀；目前沒有實作。

## 4. Article Identity 與分類規則

### 4.1 文章識別（已確認）

| 欄位／概念 | 決策 |
|---|---|
| Article Internal ID | 資料庫內部主鍵，供內部資料關聯。 |
| `doc_id` | 與內部主鍵**獨立**的公開永久識別碼。 |
| 識別碼格式 | **ULID，26 字元**，大寫（BE-002）。 |
| 公開路由 | 有 slug 時 `/posts/{slug}`，沒有時 `/posts/{docId}`（FE-015）。 |
| 產生時機 | 建立 Article 時配置。 |
| 可變性 | `doc_id` 建立後不可修改。 |
| 重複使用 | 刪除文章後亦不得將既有 `doc_id` 分配給其他文章。 |
| 版本關係 | 同一篇文章所有草稿／正式版本、封存與重新發布都保留同一 `doc_id`。 |

使用者選擇 ULID 的主要理由：網址相對短，並避免把公開識別碼的語意耦合到特定資料庫。注意 UUID 也具跨資料庫能力，ULID 不是資料庫可攜性的唯一選項。

URL 示意：

```text
/posts/01K7M4Y7P65BDCF8AHRTQY7ZQF
/posts/my-first-post
```

- Title 更名時，公開 URL 不因標題改動而改變。
- slug 由作者手動設定，換過 slug 後，上線過的舊網址留下轉址頁（FE-015、BE-023）。
- `doc_id` 是文章的身分；giscus 與 RSS 的 `<guid>` 以它為鍵，換 slug 不受影響。
- `doc_id` 是公開識別碼，不是授權或私密存取憑證；草稿／未公開文章不得因 ID 難猜而視為受保護。

### 4.2 Topic 與 Tags（已確認）

- 每篇文章恰有一個 Primary Topic；Topic 對 Article 是一對多關係。
- 每篇文章可有 0～N 個 Tags；Article 與 Tag 為多對多關係。
- 建立 Working Draft 時，Topic 即為必填；不能先建立無 Topic 的文章草稿。
- Tags 不必填。
- Title、Topic、Tags 與 Markdown 共同納入文章版本管理；草稿變更不直接更動對外已發布的 Metadata。
- Topic／Tag 的名稱屬於 Taxonomy 本身，改名、合併、刪除見 BE-013、BE-019。

## 5. CMS 與編輯體驗

### 5.1 管理功能（已確認）

- 自建 CMS，支援文章建立、讀取、編輯、刪除、發布與下架等完整生命週期。
- 編輯器以 Markdown 為內容形式，體驗參考 HackMD，可同時編輯與預覽（分割畫面）。
- 支援標題及相關 Metadata 編修。
- 支援 Auto Save（自動儲存 Working Draft）；Auto Save 不觸發網站重新部署。
- 已發布文章再次編輯時，修改應存於 Working Draft，不應即時覆蓋線上版本。
- CMS 管理員必須有身分驗證及適當授權：密碼登入（BE-009），或 Cloudflare Access（BE-026）。

### 5.2 內文圖片上傳（已確認）

- 只能透過文章 Markdown 編輯器的編輯流程上傳圖片，例如選取圖片、拖曳檔案、貼上截圖。
- 上傳後在 Markdown 中插入引用，並可於編輯器中預覽。
- 不建立獨立的媒體庫上傳工作流程／相簿管理產品功能。
- 編輯階段的圖片預覽由 FastAPI 提供；公開網站上的文章圖片，在發布時匯出成靜態資產（BE-007）。

## 6. Article Content Versioning

### 6.1 草稿／發布資料隔離（已確認）

- Working Draft 為可修改的編輯工作狀態。
- Published Version 為已定稿的不可變快照。
- 文章可有多個 Published Versions；編輯舊文章時仍保有目前公開版本。
- 不論 Title、Topic、Tags 或 Markdown，編輯中的內容均不得因 Auto Save 直接影響已部署的公開文章。
- 發布須將一組一致的內容與 Metadata 保存為新 Published Version；隨後才進入建置／部署流程。
- 歷史版本還原方式：將選定版本的內容與 Metadata 複製至 Working Draft；重新發布時建立新版本，不修改舊版本。

結構（ART-020）：

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
- 觸發條件考慮實際內容差異與經過時間／最大間隔，避免每次按鍵都建立 Snapshot；閾值見 BE-008。
- 當新 Published Version 已成功、持久地寫入資料庫，即可移除該次編輯週期的 Draft Snapshots，不必等待 GitHub Pages 部署成功。
- 延遲到達的 Auto Save 不得覆蓋使用者已確認發布的內容；以 `revision` 樂觀併發控制處理（ART-021）。

### 6.3 Published Version Retention（已確認）

- 一般情況下保留最近三個 Published Versions。
- 新版發布後，不可立即清除舊版；應等新版本對應的靜態網站成功部署後，才進行安全的舊版本清理。
- 如部署失敗，或線上／待部署中的資產仍依賴某個較舊版本，允許暫時保留超過三版以避免遺失可用資料。
- 版本清理必須與文章圖片的引用保護協調。
- 規則見 BE-011。

## 7. Article Lifecycle 與公開網站行為

### 7.1 業務狀態（已確認）

| 狀態 | CMS／資料狀態 | 正式部署完成後的公開 URL 行為 |
|---|---|---|
| Draft | 文章尚未發布，資料僅於管理端 | **404** |
| Published | 有目前的公開發布版本 | 顯示對應文章內容 |
| Archived | 下架、保留文章與版本資料 | 原網址顯示固定的**「文章已封存」提示頁** |
| Pending Deletion | 軟刪除等待期，保留復原所需資料 | **404** |
| Permanently Deleted | 文章已永久清理 | **404**；不再重新分配 DocID |

- 上表是部署成功後的期望結果。資料庫狀態變更到靜態部署完成前，公開網站可能仍顯示前一版內容。
- 封存頁與一般文章頁不同；封存頁 `noindex` 且不列入 Sitemap（FE-001）。
- Pending Deletion 的文章必須從公開文章列表、Topic／Tag 頁、搜尋結果及 Sitemap 排除，並於部署後使原網址回傳 404。
- 狀態轉換規則見 BE-005。

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
- Pending Deletion 期間須保留文章、相關版本及復原所必需的圖片，不得被圖片清理誤刪。
- 需保護尚在線上或正在部署中引用的資料，避免刪除造成既有公開資產破損。
- 恢復後沿用同一 `doc_id`，回到刪除前的狀態（BE-005）。

### 7.4 Republish（已確認）

- 下架後重新發布，沿用原 `doc_id`。
- 重新發布產生新的不可變 Published Version。
- 文章對應的公開 URL 長期固定，以減少失效外連、搜尋索引與 giscus 討論關聯變動。

## 8. 圖片儲存、發布與垃圾回收

### 8.1 圖片儲存（已確認）

- 圖片存於 PostgreSQL，不使用 Object Storage。
- 圖片 metadata／索引（`images`）與二進位內容（`image_data`，BYTEA）分開（BE-007）。
- 長期可考慮將圖片 Bytes 移至 Object Storage；目前不實作。
- 不原地覆寫可能被 Published Version 引用的圖片內容；圖片 id 是內容雜湊，換圖即為新的圖片（BE-014）。

### 8.2 靜態輸出（已確認）

- 「更新網站」時，Exporter 把已匯出文章引用的圖片寫進 Snapshot（PUB-003）。
- GitHub Actions 建置時把 Snapshot 的圖片輸出成 GitHub Pages 可直接服務的靜態檔案。
- 訪客閱讀已發布文章時，圖片不需要透過 FastAPI 或 PostgreSQL 即時提供。

### 8.3 Image Garbage Collection（已確認）

| 項目 | 規格 |
|---|---|
| 執行時機 | 定期維護 `python -m blog.maintenance` 執行（PUB-005）。 |
| 刪除前寬限期 | 圖片須持續**至少七天沒有任何有效引用**。 |
| 從未被引用的上傳 | 至少經過上傳後七天，方可考慮清理。 |
| 受保護引用 | Working Draft、仍保留的 Draft Snapshots、保留中的 Published Versions、關於頁的自我介紹。 |
| 待刪除文章 | 30 天復原期限內所需的圖片必須保留。 |
| 版本與部署協調 | 需考慮發布、Auto Save、圖片引用變動與清理工作競態；不能僅靠某一瞬間的引用計數即刪除。 |

- 七天計時從最後一個有效引用消失後開始，而不是從圖片上傳那天起一律計算。
- 已部署網站的圖片在內容 repo 中，不依賴資料庫，所以清理不會破壞線上網站。
- 引用記錄與鎖定方式見 BE-007。

## 9. Publish、CI/CD 與部署一致性

### 9.1 發布語意（已確認）

1. 管理員在 CMS 明確執行 Publish。
2. 後端保存一份新的不可變 Published Version（Title、Topic、Tags、Markdown 一致）。
3. 資料庫發布成功與網站部署成功是兩個不同事件；不能混為單一狀態。
4. 管理員按「更新網站」，後端匯出全站 Snapshot 到內容 repo，再啟動 GitHub Actions 全站 Build（PUB-001、BE-010）。
5. 部署到 GitHub Pages 後才表示新版本已真正在線上可讀。
6. 靜態網站最終必須趨近最新期望發布狀態（Latest State Wins）。

### 9.2 併發發布與過時版本（已確認）

- 新發布版本出現時，取消已過時、尚未開始的工作。
- 已經運行中的 Build 不必強制取消，可讓它完成。
- 部署前須檢查 Build 產物是否已被更新的期望狀態取代；過時產物略過部署，由更新版本的 Build 接手。
- 部署互斥／序列化。
- 以內容 repo 的 commit 順序與部署前的 HEAD 檢查辨識最新狀態（PUB-004）。
- 不針對每一個 Build 儲存永久、完整的全站快照；內容 repo 的 commit 與 `releases` 紀錄辨識實際部署的是什麼。

### 9.3 失敗處理（已確認）

- CMS 以 GitHub API 追蹤 Build／Deploy 的結果（BE-010）。
- 不自動重試。最新一筆失敗的 release 可以在 CMS 手動重試，從失敗的那一步繼續（BE-010）。
- 失敗通知使用 GitHub 內建的 workflow 失敗 Email（PUB-005）。
- 即使網站部署失敗，資料庫中已成功持久化的 Published Version 不因此自動消失。

## 10. 資料一致性、安全與清理的不變條件

以下是由已確認需求直接形成的設計約束。

1. **Identity**：一篇 Article 對應一個永久且不重複使用的 ULID `doc_id`；不等同於資料庫內部主鍵。
2. **Draft Isolation**：Working Draft 的 Auto Save、Title／Topic／Tags／Markdown 修改，不得直接修改既有 Published Version。
3. **Published Immutability**：發布後不可原地改寫 Published Version；還原歷史文章須建立新的編輯／發布過程。
4. **Publish Consistency**：建立的 Published Version 必須是同一個一致時點的內容與 Metadata；須防止 Auto Save 與 Publish 併發造成意外覆蓋。
5. **Deployment Awareness**：不能因 DB 已更新便宣稱公開網站已更新；必須追蹤線上部署狀態。
6. **Safe Retention**：清除舊版、待刪除文章或圖片之前，需確認不會破壞線上／待部署內容，且滿足必要的復原保護。
7. **Public Access Boundary**：公開讀者只能讀取已部署公開內容；CMS 編輯／草稿／媒體預覽與管理操作須適當授權。
8. **Low Runtime Dependency**：公開閱讀不應依賴即時 FastAPI API 成功回應。

## 11. Article 決策索引

> `ART-*` 是 Article 討論中使用的決策代號；其他決策以各 Addendum 的 ID 為準。

| 決策編號 | 決策內容 |
|---|---|
| ART-009 | 文章 Title、Topic、Tags 等 Metadata 與 Markdown 一同進行草稿／發布版本管理。 |
| ART-010 | 文章公開 `doc_id` 與內部資料庫 PK 分離。 |
| ART-011 | 公開 `doc_id` 選擇 ULID；沒有 slug 的文章路由為 `/posts/{docId}`。 |
| ART-012 | Unpublish 後原網址顯示固定「文章已封存」頁面。 |
| ART-013 | Delete 先進入 Soft Delete／Pending Deletion。 |
| ART-014 | 待刪除保留 30 天。 |
| ART-015 | 管理員可主動永久清除。 |
| ART-016 | Republish 保留原有 ULID DocID。 |
| ART-017 | Pending Deletion 保留可復原能力。 |
| ART-018 | Pending Deletion 的公開文章 URL 顯示 HTTP 404。 |
| ART-019 | 30 天 Soft Delete 為防止誤刪，保留復原機制。 |

## 12. Open Questions（尚未確認）

| 領域 | 待決事項 |
|---|---|
| Taxonomy | Topic／Tag 的別名策略（BE-019 沒有提供）。 |
| 廣告 | 是否放置 Google AdSense、放在哪裡（第 3.3 節）。 |
| 圖片 | 圖片 Bytes 移到 Object Storage 的時機（第 8.1 節）。 |
| 建置 | Incremental Build 與 GitHub Pages 全站部署的協作方式。 |

## 13. 文件維護規則

- Baseline 與 Addendum 01–04 都描述目前的系統。決策被推翻或不再成立時，直接把該處改寫成目前的決策。被取代的內容、更新註記、「已被取代」標記與 Supersedes 鏈都不保留；舊的版本留在 git 歷史。
- 決策 ID 保持不變，其他文件與程式註解以 ID 引用。刪除一條決策時，同時修正所有引用它的地方。
- 新的決策寫進對應的 Addendum，取下一個 ID。
- 使用者沒有確認的設計選項只列在 Open Questions，不寫成決策。標為 Accepted (delegated) 的決策是作者授權採用的設計建議，作者可隨時推翻。
