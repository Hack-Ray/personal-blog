# Personal Blog — Addendum 04：Public Site

> **基線**：[Baseline v1.0](./personal-blog-system-spec-baseline-v1.0.md)，[Addendum 02](./personal-blog-system-spec-addendum-02-publishing-pipeline.md)
> **日期**：2026-10-20
> **Status 說明**：使用者授權依助理建議進行，以下標為 Accepted (delegated)。使用者可隨時推翻。

## Decisions

### FE-001：Sitemap、canonical 與文章 metadata

- **Status**：Accepted (delegated)
- **Context**：Baseline 7.1（封存頁 noindex、Sitemap 移除）、Baseline 12「SEO／404」。
- **Decision**：
  - Build 時產生 `sitemap.xml`：首頁、文章列表、關於頁、所有 published 文章、Topic 與 Tag 頁。Archived 與不存在的文章不列入。
  - 每頁有 canonical URL。絕對網址由 `SITE_ORIGIN`（預設 `https://hack-ray.github.io`）加 basePath 組成；改用自訂網域時一併設定 `SITE_ORIGIN` 與 `BASE_PATH=""`。
  - 文章頁有 description（Markdown 轉純文字的前 120 字）與 Open Graph article metadata。
  - 封存頁 `noindex`；沒有資料時的動態路由佔位頁是 404 頁並且 `noindex`。
- **Consequences**：GitHub Pages 專案網站無法在網域根目錄放 `robots.txt`，所以不提供；改用自訂網域後可再加入。

### FE-002：純靜態文章搜尋

- **Status**：Accepted (delegated)
- **Context**：Baseline 3.1、Baseline 12「Article Search」。
- **Decision**：
  - Build 時產生 `search-index.json`（published 文章的標題、Topic、Tags、發布日期與純文字內文，內文最多 5000 字，不含程式碼區塊）。
  - `/search/` 頁在瀏覽器中搜尋：所有關鍵字都必須出現；不分大小寫的子字串比對，中文不需斷詞；標題命中 > Topic／Tag 命中 > 內文命中，同分時較新的在前。`?q=` 與輸入同步。
  - 不需要後端，不新增套件。
- **Consequences**：文章數量很大時索引會變大；屆時可改為分段載入或專用搜尋套件。

### FE-003：個人介紹／作品集以程式碼維護

- **Status**：Accepted (delegated)
- **Context**：Baseline 3.1、Baseline 12「Portfolio」。
- **Decision**：`/about/` 頁的內容來自 `frontend/src/profile.ts`（名字、標語、自我介紹、連結、經歷、作品）；空的清單不顯示該區塊。連結必須是 `https://` 或 `mailto:`（測試檢查）。
- **Consequences**：修改介紹需要改程式碼並重新部署；若之後想從 CMS 編輯，再把同樣的資料形狀搬進 Snapshot。

## Open Questions

- giscus 留言：需要在 GitHub 開啟 Discussions、安裝 giscus app，並決定 mapping 方式（Baseline 3.3 建議以 `doc_id` 對應）。
- 流量分析服務的選型（Baseline 3.3，Cloudflare Web Analytics 為候選）。
- `profile.ts` 的實際內容需由使用者填寫。
