# Personal Blog — Addendum 04：Public Site

> **這是設計紀錄，不是教學。** 記錄開發時的需求與架構決策及其理由；實際行為以程式碼為準。要建立自己的部落格請看 [`fork-and-deploy.md`](../fork-and-deploy.md)。

> **基線**：[Baseline v1.0](./personal-blog-system-spec-baseline-v1.0.md)，[Addendum 02](./personal-blog-system-spec-addendum-02-publishing-pipeline.md)
> **日期**：2026-10-20，2026-10-27 補上 FE-014–FE-018
> **Status 說明**：標為 Accepted (delegated) 的決策，由作者授權採用設計建議，作者可隨時推翻。

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
- **Amended by**：FE-014（`SITE_ORIGIN` 與 basePath 改由部署環境提供，並產生 `robots.txt`）、FE-015（文章網址可以是 slug）。

### FE-002：純靜態文章搜尋

- **Status**：Accepted (delegated)
- **Context**：Baseline 3.1、Baseline 12「Article Search」。
- **Decision**：
  - Build 時產生兩種搜尋檔案。`search-metadata.json` 含 published 文章的標題、Topic、Tags、發布日期與內文前 160 字。`search-data/<年>-<hash>/chunk.json` 依台北時間的發布年份各一份，含該年文章的完整搜尋文字。搜尋文字是摘要加純文字內文（不含程式碼區塊），最多 5000 字，在全形標點與空白處切成片語，每個片語只留一次，並預先轉成小寫。
  - 使用者點進搜尋框或進入 `/search/` 時先下載 `search-metadata.json`，再由新到舊依序下載各年份內文。每載完一年，結果就自動更新並重新排序。下載失敗時保留已有結果，可以從失敗的年份重試。
  - `/search/` 頁在瀏覽器中搜尋：所有關鍵字都必須出現；不分大小寫的子字串比對，中文不需斷詞；標題命中 > Topic／Tag 命中 > 內文命中，同分時較新的在前。`?q=` 與輸入同步。
  - 不需要後端，不新增套件。
- **Consequences**：第一次搜尋只需要等小索引，舊文章的內文命中會晚一點出現。總下載量仍隨文章數成長；若要再縮小，可改用只下載相關片段的搜尋套件。含全形標點的關鍵字搜不到內文。

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
- **Amended by**：FE-014（repo 與分類的 ID 改由 Actions variables 提供，不寫在程式碼）。

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
- **Amended by**：FE-017（沒有圖片的文章與其他頁面改用預設分享圖，每頁都有 `og:image`）。

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

### FE-011：文章摘要、封面、系列、置頂、更新日期與瀏覽輔助

- **Status**：Confirmed（使用者 2026-10-21 指定）
- **Context**：第二輪擴充清單的「公開網站」一組。
- **Decision**：
  - 文章檔新增可省略的鍵（BE-018）：`updated_at`、`excerpt`、`cover`、`series: {slug, name}`、`pinned_at`。沒有設定時不輸出，之前匯出的內容不受影響，`schema_version` 維持 1。`cover` 必須是文章 Markdown 中的 `images/` 圖片，否則 build 失敗。
  - 摘要：有 `excerpt` 時用於列表、meta description、分享預覽與 RSS，並併入搜尋內容；沒有時沿用自動擷取的前 120 字。
  - 封面：有 `cover` 時取代「第一張上傳圖片」規則（FE-004、FE-008），用於列表縮圖與 `og:image`。
  - 縮圖：build 時以 sharp 為每張點陣圖產生寬 320px 的 WebP 到 `thumbs/`，列表使用縮圖，文章內文仍用原圖；SVG 直接使用原圖。sharp 原為 Next.js 的選用相依套件，改為明確的 devDependency 並固定版本。
  - 更新日期：文章頁的 metadata 列在發布日期後顯示「更新於」；sitemap 的 `lastmod` 與 `article:modified_time` 使用更新時間。列表不顯示更新日期。
  - 系列：文章頁標題下方顯示系列名稱、本篇是第幾篇與全部篇目（依發布時間由舊到新），本篇不加連結。
  - 置頂：首頁先列出置頂文章（最近置頂的在前，標「置頂」），再列出最新 5 篇未置頂文章。`/posts/` 不受影響。
  - 分頁：`/posts/` 每頁 10 篇，第 2 頁起為 `/posts/page/<n>/`，只有一頁時不顯示分頁列。分頁後不再於 `/posts/` 切換排序；Baseline 3.1 的新到舊／舊到新排序改由歸檔頁提供。
  - 歸檔：`/archive/` 依年、月分組列出所有已發布文章（以台北時間判斷年月），可切換新到舊／舊到新；`/posts/` 頂部有連結。歸檔與各分頁加入 sitemap。
  - 閱讀進度與回到頂端：文章頁頂端有細進度條；捲動超過一個畫面高度後右下角出現回到頂端按鈕，使用者偏好減少動態時不使用平滑捲動。
  - 外部連結：內文中 `http(s)://` 開頭、且不是本站網址的連結在新分頁開啟（`rel="noopener noreferrer"`），文字連結後加 ↗；只包住圖片的連結不加標記。
  - 404：顯示搜尋框與最新 5 篇文章。最新文章在瀏覽器端從 `latest-posts.json` 讀取，因為每一頁的 payload 都含有 404 頁，在 build 時寫入會讓所有頁面都帶著這份清單。
- **Consequences**：摘要、封面與系列屬於文章版本，修改後要重新發布；重新發布會產生「更新於」。置頂不需要重新發布，下次「更新網站」生效。

### FE-012：CMS 預覽與發布前檢查

- **Status**：Confirmed（使用者 2026-10-21 指定）
- **Decision**：
  - CMS 編輯器與「網站與關於」的預覽使用和公開網站相同的排版（從 `globals.css` 複製 `.article-body` 樣式）、圖說、外部連結標記與 Shiki 主題。Shiki 只載入網站支援的語言與兩個主題，開啟編輯器後才非同步載入；載入前程式碼以純文字顯示。CMS 用 JavaScript regex engine，避免載入 WASM，極少數語法的配色可能與網站略有不同。
  - 發布前檢查：按「發布」時，若沒有 Tag、有圖片沒有替代文字、標題超過 60 字、有 `http://` 連結或圖片、內文有 `TODO`、或封面圖已不在文章中，先列出提醒並詢問是否仍要發布。提醒不會阻擋發布。
- **Consequences**：預覽與網站的 renderer 是兩份程式碼（`cms/src/preview.ts` 與 `frontend/src/content/markdown.ts`），修改其一時要同步另一份。

### FE-013：文章不允許原始 HTML，網址採白名單

- **Status**：Confirmed（使用者 2026-10-22 決定）
- **Context**：CMS 預覽與公開網站原本都會輸出文章裡的 HTML 與 `javascript:` 連結。預覽與 CMS 同源，貼上的內容一顯示就能帶著 session 發布或刪除文章。只跳脫 HTML 也不夠，`[x](javascript:...)` 是標準的 Markdown 語法。
- **Decision**：
  - 文章與關於頁介紹裡的原始 HTML 一律跳脫成純文字。
  - 連結只允許 `https:`、`http:`、`mailto:`、`#` 錨點和相對路徑；圖片只允許 `images/` 開頭的路徑和 `https:`。
  - 其他網址讓 build 失敗（`frontend/src/content/url-policy.ts`），CMS 預覽不輸出、發布前檢查擋下。CMS 另外警告含原始 HTML 的文章。
  - 規則的測試案例放在 `frontend/test-fixtures/url-policy.json`，前端與 CMS 共用。
  - 之後需要嵌入影片或摺疊區塊時，為那一種需求加專用的 Markdown 語法，由 renderer 產生固定的 HTML，不重新開放原始 HTML。
- **Consequences**：作者確認現有文章沒有使用原始 HTML，上線不改變顯示（#27）。
- **Supersedes**：無。

### FE-014：網址、網域與各站設定由部署環境提供

- **Status**：Confirmed（使用者 2026-10-22 與 2026-10-26 決定）
- **Context**：FE-001 的 `SITE_ORIGIN` 預設是作者的 Pages 網址，FE-006 的 giscus ID 寫在程式碼。別人 fork 後必須改程式才能部署，換成自訂網域也要改程式。這個 repo 是公開的，作者的網域與帳號資料不應該寫進程式碼。
- **Decision**：
  - `deploy.yml` 從 `actions/configure-pages` 取得網站的 origin 與 basePath，傳給 build 的 `SITE_ORIGIN` 與 `BASE_PATH`。Pages 設定自訂網域後，下一次部署就使用新網域，不需要改程式。直接 build 時的預設是 `https://example.com` 與 `/personal-blog`。
  - 每個站不同的值都放在 Actions variables 與 secrets：`CONTENT_REPO`（預設 `<repo>-content`）、`GISCUS_REPO`、`GISCUS_REPO_ID`、`GISCUS_CATEGORY`、`GISCUS_CATEGORY_ID`、`GOOGLE_SITE_VERIFICATION`、`LEGACY_SITE_URLS`。程式碼與文件不寫作者的網域，文件用 `<網域>` 這類替代字。
  - build 產生 `robots.txt`，其中的 sitemap 網址來自這次 build 的 `SITE_ORIGIN`。網站在網域根路徑時，爬蟲才讀得到它。
  - `LEGACY_SITE_URLS` 列出舊站的根網址。build 時，Markdown 連結中指向舊站的部分改成新站的相對網址，內容 repo 不改寫。
  - RSS 的 `<guid>` 是 `urn:ulid:<docId>`，換網域或 basePath 都不會變。
  - 自訂網域接 CDN 時，先讓 Pages 以自訂網域取得憑證並開啟 Enforce HTTPS，再開 CDN proxy，SSL 用 Full (strict)。CDN 不快取 HTML 與 JSON，所以部署後不需要清除快取；圖片沿用 Pages 的 10 分鐘快取，部署後最多 10 分鐘內可能看到舊圖。步驟在 `docs/site-domain.md`，以 Cloudflare 為例。
- **Consequences**：fork 的人只要設定 variables 就能部署（`docs/fork-and-deploy.md`）。從 GitHub Pages 預設網址換到自訂網域時，RSS 閱讀器可能把舊文章再顯示一次，這是 GUID 改成 ULID 時的一次性遷移。CSP 的套用方式見 FE-018。
- **Supersedes**：FE-001 的 `SITE_ORIGIN` 預設值與「不提供 `robots.txt`」，FE-006 中 ID 寫在 `comments.tsx` 的做法。

### FE-015：文章可以使用英文 slug 網址，舊網址留下轉址頁

- **Status**：Confirmed（使用者 2026-10-26 指定）
- **Context**：Baseline 4.1 讓文章網址固定為 `/posts/<docId>/`。ULID 網址穩定，但讀者看不出文章在講什麼，分享時也不好看。
- **Decision**：
  - 作者可以在 CMS 替文章設定英文 slug，公開網址變成 `/posts/<slug>/`；沒有設定時仍是 `/posts/<docId>/`。slug 由作者手動輸入，CMS 不呼叫任何翻譯或 AI 服務。
  - slug 與置頂一樣屬於文章、不進版本：欄位失焦就儲存，下一次「更新網站」生效，不需要重新發布。格式、唯一性與保留字見 Addendum 03 BE-023。
  - 實際上線過的網址，換成新網址後會留下轉址頁。GitHub Pages 不能回傳 301，所以轉址頁是 `noindex`、canonical 指向新網址，並以 `<meta http-equiv="refresh">` 立即轉到新網址。沒有上線過的網址不產生轉址頁，避免每篇文章都多一頁 docId 轉址頁。轉址頁不進 sitemap。
  - giscus 的 mapping 與 RSS 的 `<guid>` 仍以 `doc_id` 為鍵，換 slug 不會換到另一個討論串，閱讀器也不會重複顯示。
  - 站內所有文章連結都經過 `postPath()`（`frontend/src/content/queries.ts`）。`search-metadata.json` 與 `latest-posts.json` 直接帶好 `path`，client 元件不需要知道 slug 規則。
  - manifest 的每篇文章可帶 `slug` 與 `redirect_from`。前端 parser 檢查格式，並檢查任一個 `/posts/<片段>/` 只屬於一篇文章，否則 build 失敗。
- **Consequences**：改 slug 後，舊網址要經過一次轉址才到文章，搜尋引擎也要重新收錄新網址。
- **Supersedes**：Baseline 4.1 中「公開網址固定為 `doc_id`」的限制；`doc_id` 仍是文章的身分。

### FE-016：文章頁的分享按鈕

- **Status**：Confirmed（使用者 2026-10-26 至 2026-10-27 指定）
- **Context**：讀者要分享文章只能自己複製網址。Instagram 沒有網頁分享網址，不列入。
- **Decision**：
  - 已發布文章的留言區上方有一列分享按鈕：Facebook、X、Threads、LINE，最後一顆在支援 Web Share API 的觸控裝置上是「更多分享方式」，其他情況是「複製連結」。
  - 分享網址由 `frontend/src/content/share.ts` 產生，只是一般連結，不載入任何平台的 SDK 或追蹤程式。分享的是文章的 canonical 網址。
  - 圖示是內嵌的 Simple Icons（CC0）SVG，不另外下載。
  - 手機的 Facebook App 會攔下 facebook.com 連結，並丟掉要分享的網址。所以觸控裝置支援 Web Share API 時，Facebook 按鈕與「更多分享方式」都打開系統分享選單。電腦的瀏覽器不支援 clipboard 時不顯示「複製連結」。
  - 傳給 `navigator.share` 的是網址與標題。只傳網址不會讓 iOS 分享選單顯示網站圖示（#86 試過後以 #87 還原）。
- **Consequences**：iOS 分享選單上方的預覽由系統決定。從 `navigator.share` 開啟時通常顯示指南針圖示；只有 Safari 自己的分享按鈕會顯示 `og:image` 或 touch icon。系統分享選單中 App 的排列順序由作業系統控制。

### FE-017：網站圖示與預設分享圖

- **Status**：Confirmed（使用者 2026-10-27 指定）
- **Context**：網站沒有 favicon，沒有圖片的文章分享到社群或 iOS 分享選單時沒有預覽圖。
- **Decision**：
  - 圖示的來源只有 `frontend/public/icon.svg`。`npm run icons`（`frontend/scripts/make-icons.ts`）由它產生 `favicon.ico`、180×180 的 `apple-touch-icon.png` 與 1200×630 的 `og-default.png`，產生的檔案一起 commit，build 不重新產生。
  - layout 宣告 `favicon.ico`、SVG 圖示與 touch icon，路徑都加上 basePath。
  - 沒有封面也沒有上傳圖片的文章，以及首頁、列表等非文章頁，`og:image` 都是 `og-default.png`。有圖片的文章仍用 FE-008 與 FE-011 的規則。`twitter:card` 只有文章自己有圖時是 `summary_large_image`，其餘為 `summary`。
- **Consequences**：fork 的人換掉 `icon.svg` 並執行 `npm run icons`，就能換成自己的圖示與預設分享圖。
- **Supersedes**：FE-008 中「沒圖時不輸出 `og:image`」。
- **Amended by**：FE-020（沒有封面也沒有上傳圖片的文章改用依標題畫的分享圖，`twitter:card` 一律 `summary_large_image`；非文章頁仍是 `og-default.png`）。

### FE-018：CSP 寫在每個 HTML 的 meta，CDN 只加固定標頭

- **Status**：Confirmed（使用者 2026-10-27 同意加上 CSP）
- **Context**：GitHub Pages 不能設定回應標頭。原本 build 產生 `cdn-headers.json`，列出每一頁含 inline script hash 的 CSP 標頭，等 CDN 逐頁套用。但 hash 每次部署都會變，Cloudflare 的 Transform Rules 是固定規則，要逐頁套用得寫 Worker 並在每次部署後同步，還會在 HTML 與設定不同步的那段時間擋掉 script。
- **Decision**：
  - build 在每個 HTML 的 charset 之後插入 `<meta http-equiv="Content-Security-Policy">`，政策由 `frontend/src/content/cdn-headers.ts` 依該頁的 inline script 計算。script 只允許 `'self'`、`https://giscus.app` 與該頁 inline script 的 SHA-256；`style-src` 保留 `'unsafe-inline'`，並允許 giscus 載入自己的樣式表（`https://giscus.app/default.css`）；`img-src` 允許 `https:` 與 `data:`；`connect-src` 只有 `'self'`；`frame-src` 只有 giscus；`object-src 'none'`、`base-uri 'self'`、`form-action 'self'`。
  - meta 不支援 `frame-ancestors`。`frame-ancestors 'none'`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin` 是每個回應都一樣的固定標頭，由 CDN 加上（Cloudflare 用一條 Response Header Transform Rule）。步驟在 `docs/site-domain.md`。
  - e2e 測試在沒有任何回應標頭的靜態伺服器上執行，所以也檢查 meta CSP：頁面沒有 CSP 違規，未列入的 inline script 不會執行。
- **Consequences**：CSP 在沒有 CDN 的 fork 上也生效，部署不需要同步 CDN 設定。meta 版 CSP 沒有 Report-Only 模式，政策錯誤會在部署後直接擋住功能，所以靠 e2e 在合併前發現。CDN 若往 HTML 插入其他網域的 script（例如 Cloudflare Web Analytics 的自動注入）會被擋下，Rocket Loader 必須關閉。
- **Supersedes**：`cdn-headers.json` 原本帶逐頁 CSP 標頭、由 CDN 逐頁套用的做法；檔案只保留快取標頭與上述固定標頭。

### FE-020：沒有封面的文章，build 依標題畫分享圖

- **Status**：Confirmed（使用者 2026-10-28 指定）
- **Context**：FE-017 讓沒有圖片的文章都分享同一張 `og-default.png`，貼到社群或聊天軟體時彼此看不出差別。
- **Decision**：
  - `npm run build`／`dev` 在 `copy-snapshot-images.ts` 之後執行 `scripts/generate-share-images.ts`，替每篇已發布、沒有封面也沒有上傳圖片的文章（`coverOf()` 為空）畫一張 1200×630 的 PNG，寫到 `public/og/<docId>.png`。檔名用 `docId`，換 slug 不會讓舊的分享連結失效。每次先刪除整個 `public/og` 再重畫，所以重跑結果相同；輸出與 `public/thumbs` 一樣不 commit。
  - 圖的內容是 SVG 字串（`content/share-image.ts` 的 `shareImageSvg()`，純函式，輸入標題、網站名稱、主題與日期），再由 sharp 轉成 PNG，不新增 satori 等依賴。配色取自網站的深色主題，左上角是 `public/icon.svg` 的 R 圖示與 `profile.json` 的網站名稱，標題用大字置中，左下角是主題與發布日期（`Asia/Taipei`）。
  - sharp 沒有排版引擎，所以標題自己斷行：全形字佔 1 em、半形約 0.55 em；中文逐字斷，英文在空格斷，過長的單字逐字元斷；`，。、！？）」』` 等不放在行首、`（「『` 不放在行尾；最多 3 行，字級從 88、72、60 px 取放得下的最大者，仍放不下時最後一行以「…」結尾。字元以 XML 跳脫。
  - 字型是 sharp 內的 librsvg 透過 fontconfig 找的系統字型，`font-family` 依序為 Noto Sans CJK TC、Noto Sans TC、PingFang TC、Microsoft JhengHei、sans-serif，所以 Mac 本機也能 build。只要有標題、網站名稱或主題含中日韓字元，腳本就用 `fc-list :lang=zh-tw` 檢查，沒有任何中文字型就讓 build 失敗，而不是輸出方框；沒有 `fc-list` 時只警告。`ci.yml` 的 frontend job 與 `deploy.yml` 的 build job 在 build 前檢查是否已有 Noto Sans CJK，沒有才 `apt-get install fonts-noto-cjk`。
  - 文章頁的 `og:image`、`twitter:image` 與 JSON-LD `BlogPosting.image` 都由 `shareImageOf()` 決定：有封面或上傳圖片用該圖，否則 `/og/<docId>.png`，三處一致；因為規則是確定的，不另存清單。畫出來的圖輸出 `og:image:width`／`height`（1200、630）與 `og:image:alt`。`twitter:card` 一律 `summary_large_image`。RSS 沒有圖片欄位，不變。首頁、列表等非文章頁、導向頁與封存頁維持 `og-default.png` 或不輸出。
  - 以 4 個並行的 worker 畫圖。本機（4 核心）範例資料 2 張約 0.1 秒；1000 篇（壓力測試資料）約 24 秒、31 MB。PNG 用調色盤與低壓縮等級，因為最高壓縮要 2.3 倍時間，只省 2% 的檔案大小。
- **Consequences**：build 多了一個耗時隨文章數線性成長的步驟，以及對系統中文字型的依賴；fork 的人在本機 build 含中文標題的內容時需要先裝中文字型。圖的外觀改在 `share-image.ts`，不需要動 CMS。分享平台會快取圖片，標題改了以後平台上的預覽要等它重抓。
- **Supersedes**：FE-017 中沒有圖片的文章用 `og-default.png`，以及該類文章的 `twitter:card` 為 `summary`。

## Open Questions

- ~~流量分析服務的選型（Baseline 3.3，Cloudflare Web Analytics 為候選）。~~ 公開網站不放任何分析或追蹤程式。流量改在 CMS 從 Cloudflare 與 Search Console 的 API 讀取，見 Addendum 03 BE-024。
