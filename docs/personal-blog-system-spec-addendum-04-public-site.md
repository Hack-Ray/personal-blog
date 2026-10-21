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

- **Status**：Superseded by FE-007
- **Context**：Baseline 3.1、Baseline 12「Portfolio」。
- **Decision**：`/about/` 頁的內容來自 `frontend/src/profile.ts`（名字、標語、自我介紹、連結、經歷、作品）；空的清單不顯示該區塊。連結必須是 `https://` 或 `mailto:`（測試檢查）。
- **Consequences**：修改介紹需要改程式碼並重新部署；若之後想從 CMS 編輯，再把同樣的資料形狀搬進 Snapshot。
- **Superseded by**：FE-007（介紹改由 CMS 編輯，經 Snapshot 發布）。

### FE-004：文章列表顯示第一張圖片與摘要

- **Status**：Confirmed（使用者 2026-10-20 指定）
- **Context**：文章列表原本只有標題與 metadata，看不出文章內容。
- **Decision**：
  - 首頁、文章列表、Topic 頁與 Tag 頁的每篇文章顯示摘要與縮圖。
  - 摘要沿用 FE-001 的 description（Markdown 轉純文字的前 120 字），畫面上最多顯示三行，超過以省略號截斷。
  - 縮圖是文章中第一張上傳圖片（`images/` 引用），略過程式碼區塊內的圖片與外部網址圖片；沒有圖片的文章不顯示縮圖。
  - 縮圖寬 160px（螢幕寬 480px 以下為 96px），16:10 裁切，延遲載入。
- **Consequences**：縮圖直接使用文章原圖（BE-014 後最寬 1440px 的 WebP），沒有另外產生小圖；文章多時可再加 build 時產生縮圖。

### FE-005：程式碼高亮、上下篇導覽、頁尾與 RSS

- **Status**：Confirmed（使用者 2026-10-21 指定）
- **Context**：程式碼區塊沒有語法高亮，文章讀完後沒有下一步，網站也沒有頁尾或訂閱方式。
- **Decision**：
  - 程式碼高亮在 build 時由 `shiki` 產生（新增的唯一依賴，固定版本），雙主題 `github-light`／`github-dark`，以 CSS 變數跟隨 `prefers-color-scheme`，不增加瀏覽器端 JavaScript。支援的語言是固定清單（ts、tsx、js、jsx、json、bash、sh、python、go、rust、java、c、cpp、csharp、sql、yaml、html、css、markdown、diff、dockerfile）；未知或未標示的語言以跳脫後的純文字顯示。
  - 文章頁底部顯示上一篇（較舊）與下一篇（較新），依發佈時間在已發佈文章中排序；封存文章頁不顯示。
  - 頁尾顯示 `© <build 年份> Hack-Ray`、GitHub 與 RSS 連結。
  - `/feed.xml` 為 RSS 2.0，內容是最新 20 篇已發佈文章（標題、連結、發佈時間、FE-001 的摘要、Topic）。`lastBuildDate` 取最新文章的發佈時間而不是 build 時間，讓輸出可重現。每頁 `<head>` 帶 feed 的 autodiscovery 連結。
- **Consequences**：build 時多載入 shiki 與語法檔，build 時間略增；清單外的語言不會高亮，需要時再擴充清單。Feed 只放摘要，讀者需點回網站閱讀全文。

### FE-006：giscus 留言

- **Status**：Confirmed（使用者 2026-10-21 指定）
- **Context**：Baseline 3.2、3.3 已決定留言交給 giscus，對應方式待定。
- **Decision**：
  - 已發布文章底部載入 giscus，討論串放在 `Hack-Ray/personal-blog` 的 Announcements 分類；封存頁不顯示。
  - mapping 用 `specific`，字串是文章的 `doc_id`，並開啟嚴格匹配。改標題、網域或 basePath 都不會換到另一個討論串。
  - 主題跟隨系統深淺模式，介面語言 zh-TW，延遲載入。
  - repo 與分類的 ID 寫在 `frontend/src/app/posts/[docId]/comments.tsx`；ID 為空時不顯示留言區。
- **Consequences**：討論串在第一則留言時由 giscus 建立，標題就是 `doc_id`。留言者需要 GitHub 帳號。

### FE-007：關於頁內容由 CMS 編輯

- **Status**：Confirmed（使用者 2026-10-21 指定）
- **Context**：FE-003 把介紹寫在 `frontend/src/profile.ts`，修改需要改程式碼。作者希望和文章一樣在 CMS 編輯。
- **Decision**：
  - `/about/` 頁讀取 Snapshot 根目錄的 `profile.json`，資料形狀與 FE-003 相同（名字、標語、自我介紹、連結、經歷、作品）；`frontend/src/profile.ts` 刪除。
  - 自我介紹改為 Markdown，以文章相同的 renderer 產生，可引用 `images/` 圖片。
  - 前端解析的嚴格程度與文章相同：名字、連結名稱、經歷職稱、作品名稱不可空白；連結與作品網址必須是 `https://` 或 `mailto:`；作品沒有網址時省略 `url`；自我介紹引用的圖片必須存在。不符合時 build 失敗、不部署。
  - Snapshot 沒有 `profile.json` 時（此功能之前匯出的內容 repo、`test-fixtures/empty-site-data`），使用與 FE-003 相同的預設內容（名字 Hack-Ray、GitHub 連結），網站不變。
  - CMS 新增「關於」頁，以「儲存」按鈕明確存檔，不自動儲存。修改要到「網站發布 → 更新網站」才會上線。後端與匯出規則見 Addendum 03 BE-017。
- **Consequences**：介紹的修改不再需要改程式碼。預設內容同時存在於 migration 0008 的 seed 與 `frontend/src/content/parse.ts`，後端測試檢查兩者一致。
- **Supersedes**：FE-003。

### FE-008：分享預覽、閱讀時間、目錄與手動深淺色

- **Status**：Confirmed（使用者 2026-10-21 指定）
- **Context**：文章貼到社群沒有預覽圖，長文沒有導覽，深淺色只能跟隨系統。
- **Decision**：
  - 分享預覽：文章頁的 `og:image` 是第一張上傳圖片（規則同 FE-004）的絕對網址，`twitter:card` 有圖為 `summary_large_image`、沒圖為 `summary` 且不輸出 `og:image`。全站 `og:site_name` 為網站名稱（FE-009，原為固定的 Personal Blog）、`og:locale` 為 `zh_TW`，非文章頁的 `og:type` 為 `website`；文章頁自己的 `openGraph` 會取代而不是合併 layout 的設定，所以由 `siteOg()` 展開帶入。
  - 閱讀時間：只顯示在文章頁的 metadata 列，格式「約 N 分鐘」；中日韓字元每分鐘 400 字，其他文字每分鐘 200 詞，只計純文字（不含程式碼區塊與圖片），無條件進位、最少 1 分鐘。
  - 目錄：renderer 為 h2、h3 產生固定 `id`（保留中文、英文轉小寫、空白轉 `-`、移除標點，重複時加 `-2`、`-3`）。文章至少有 3 個 h2／h3 時，內文上方顯示「目錄」，h3 縮排在 h2 之下；連結為純 `#id`，不受 basePath 影響。
  - 手動深淺色：頁首「關於」之後的按鈕依序切換跟隨系統、淺色、深色，選擇存在 `localStorage`，以 `<html data-theme="light|dark">` 套用，沒有屬性即跟隨系統。`<head>` 內的小段 inline script 在繪製前套用，避免閃爍。giscus 初始主題依選擇計算，切換時以 `postMessage` 通知 iframe。
- **Consequences**：多了一段 inline script 與一個 client 元件；`localStorage` 不可用時（無痕模式等）退回跟隨系統。社群平台通常不支援 SVG 預覽圖，實際內容的圖片為 WebP（BE-014）。

### FE-009：網站名稱與簡介由 CMS 編輯

- **Status**：Confirmed（使用者 2026-10-21 指定）
- **Context**：網站名稱「Personal Blog」與 RSS 的頻道說明寫死在前端程式碼，修改需要改程式碼並重新部署。
- **Decision**：
  - `profile.json` 新增 `site: {title, description}`，與關於頁一起由 CMS 編輯、經同一條 Snapshot 流程發布（FE-007、Addendum 03 BE-017）。
  - `title`（網站名稱）不可空白；`description`（網站簡介）可為空字串。
  - 網站名稱用於：預設頁面標題與標題範本（`文章 | <網站名稱>`）、頁首的網站名稱、RSS 自動探索 `<link rel="alternate">` 的 `title`、`og:site_name`、RSS 頻道的 `<title>`。
  - 網站簡介不為空時，作為 layout 的 `description` meta（首頁與沒有自己 description 的頁面沿用）與 RSS 頻道的 `<description>`。RSS 2.0 要求頻道一定要有說明，所以簡介為空時 RSS 改用網站名稱；原本寫死的「Hack-Ray 的軟體工程文章」移除。
  - `site` 在檔案中可省略：沒有 `profile.json`，或 `profile.json` 沒有 `site`（此功能之前匯出的內容 repo）時，使用 `{title: "Personal Blog", description: ""}`，網站不變。`site` 不是物件、名稱空白或欄位型別錯誤時 build 失敗。
  - CMS 的「關於」頁改名為「網站與關於」（路由仍是 `#/profile`），最上方新增「網站」區塊，有「網站名稱」與「網站簡介」兩個欄位；驗證、未儲存提示與 409 衝突處理和頁面其他欄位相同。
- **Consequences**：
  - 預設值同時存在於後端 `blog/profile.py` 的 `DEFAULT_SITE_TITLE` 與 `frontend/src/content/parse.ts` 的 `DEFAULT_SITE`；後端測試以前端 parser 解析匯出的 `profile.json`，檢查兩者一致。
  - 此版本之後第一次「更新網站」時，`profile.json` 會多出 `site`，即使沒有其他修改也會產生一個 release commit；內容與預設相同，網站不變。
  - 頁尾的 `© Hack-Ray` 與 GitHub 連結仍寫死，不在此範圍。

### FE-010：分類總覽、相關文章、程式碼複製、圖片放大與頁尾

- **Status**：Confirmed（使用者 2026-10-21 指定）
- **Context**：第二輪擴充清單的推薦五項。
- **Decision**：
  - 分類總覽：新增 `/topics/` 與 `/tags/`，列出每個主題或標籤與已發布文章數，依篇數多到少、同數依名稱排序。兩頁頂部可互相切換，頁首導覽新增「分類」連到 `/topics/`；寬度 480px 以下搜尋框移到導覽連結下方獨立一列。兩頁加入 sitemap。
  - 相關文章：文章頁內文之後顯示最多 3 篇「相關文章」。同主題 2 分、每個共同標籤 1 分，0 分不列入，同分時較新的在前；build 時計算。
  - 程式碼複製：每個程式碼區塊右上角有「複製」按鈕，滑過時顯示，觸控裝置一直顯示。按鈕在 HTML 中預設 `hidden`，瀏覽器支援 Clipboard API 時才由 client 元件顯示。
  - 圖片：段落中只有一張圖片且 alt 不為空時輸出 `<figure>`，alt 作為 `<figcaption>`。內文圖片延遲載入；不在連結內的圖片點擊後以 `<dialog>` 放大，點擊或 Esc 關閉。圖片的 alt 與 title 在輸出前跳脫（marked 預設不跳脫 alt）。關於頁的自我介紹適用相同行為。
  - 頁尾：`profile.json` 的 `site` 新增 `footer`（上限 200 字，可空白）。不為空時頁尾顯示此文字，空白時顯示「© 年份 名字」。頁尾連結改為關於頁的連結清單，最後是 RSS。沒有 `footer` 鍵（此功能之前匯出的內容）時視為空白。CMS「網站與關於」的「網站」區塊新增「頁尾文字」。
- **Consequences**：頁尾不再寫死 Hack-Ray 與 GitHub 連結，預設內容（FE-007）下網站外觀不變。此版本之後第一次「更新網站」時 `profile.json` 會多出 `footer`。

## Open Questions

- 流量分析服務的選型（Baseline 3.3，Cloudflare Web Analytics 為候選）。
