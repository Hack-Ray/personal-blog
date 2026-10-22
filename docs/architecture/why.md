# 為什麼架構長這樣

> **文件性質**：給要改架構前想先知道「為什麼」的工程師（常常是作者本人或 AI agent）的導讀。內容反映 2026-10-22 的 `main`，加上分支 `docs/architecture-and-cleanup` 在 addenda 補登的 BE-021、FE-013（兩者轉錄自 `git show main:docs/backlog.md` 裡 2026-10-22 的作者決定）。
>
> **權威紀錄在 `docs/design/`**。本文件只整理證據與可信度，不新增決策。兩者不一致時以 `docs/design/` 為準，並回報不一致處。

## 怎麼讀這份文件

每個決策分四段：

- **找到的證據**：有文字出處的說法，附引用。標 [Direct]（單一明確出處）或 [Supported]（多個間接證據指向同一結論）。
- **合理推論**：沒有人寫下，但從證據推得出的說法。用「看起來」「可能」等語氣，並寫出推論過程。
- **其他可能的解釋**：證據能支持不只一種說法時，並列呈現。
- **不知道的事**：查過但找不到的事，寫明查了哪裡。

引用格式：`baseline:34` 指 `docs/design/personal-blog-system-spec-baseline-v1.0.md` 第 34 行；`addendum-0N` 同理；`old backlog` 指 `git show main:docs/backlog.md`（今天改寫前的版本）。程式碼只用來說明「做了什麼」，不當作「為什麼」的證據。

---

## 1. 公開網站完全靜態（Next.js export、GitHub Pages）

### 找到的證據

- [Direct] 預算與維護負擔是明確需求。baseline:34「預算 | 月度目標約 **NT$500**」；baseline 1.2 要求「盡量減少長期常駐後端、無必要的基礎設施與維護負擔」。
- [Direct] 公開閱讀不能依賴後端。baseline 1.2「訪客瀏覽公開文章不應依賴 FastAPI 即時在線；後端停機不應影響已部署的靜態文章閱讀」；Invariant 8（baseline:325）「**Low Runtime Dependency**：公開閱讀不應依賴即時 FastAPI API 成功回應。」
- [Direct] 接受最終一致性。baseline:38「內容發布與網站部署允許 **最終一致性（Eventual Consistency）**」。
- [Direct] 技術選定。baseline:82「公開網站採用 Static Site Generation（SSG）；使用 Next.js `output: 'export'` 產生靜態檔案。」baseline 2.2 另寫「不在 V1 使用持續運作的 Next.js Server、SSR 或 ISR」，以及「V1 每次發布採全站完整建置」。
- [Direct] 整體取向。baseline 1.1「兼顧個人使用、有限流量及低維護成本；不為低機率需求過度設計」。
- 這些都在 baseline 的 Confirmed 範圍內（baseline 0.1 定義「已確認」為「使用者已明確選定」）。

### 合理推論

- 預算、零常駐後端、後端停機不影響閱讀這三個需求，看起來同時排除了 SSR 與自架伺服器，靜態輸出加免費靜態託管是最直接的解。這是從需求推出的，紀錄裡沒有寫成比較。
- README:162「There is no server or database to attack and no hosting bill.」是對外介紹文字，不是決策紀錄。它與上述需求一致，但不能當作當初的理由。

### 其他可能的解釋

- **選 GitHub Pages 是因為成本與 repo 已在 GitHub**：與預算需求及 GitHub Actions 部署一致，但沒有文字說明。
- **選 Next.js 是延續作者熟悉或想練習的技術**：沒有證據支持或反駁。

### 不知道的事

- 找不到 GitHub Pages 與 Vercel、Netlify、Cloudflare Pages 的比較；也找不到 Next.js 與其他靜態產生器（Astro、Hugo 等）的比較。查過 `docs/design/`、PR #1 到 #55、兩份 Claude Docs 文件。
- baseline 的決策來自 2026-10-11 前的討論，討論本身不在 repo。

---

## 2. 獨立的私有內容 repo，CI 建置 Content Snapshot

### 找到的證據

- [Direct] PUB-001（Confirmed 2026-10-20，addendum-02:12-27）。Context：「Baseline 2.1 未決定 GitHub Actions 如何安全存取後端；1.2 要求低成本、減少常駐後端」。Decision：「GitHub Actions 不存取 FastAPI 或 PostgreSQL」（addendum-02:20），且「V1 不使用 Redis、Message Queue、Object Storage、雲端 Scheduler 或獨立微服務」。Consequence：「Exporter 與 Snapshot 格式成為 CMS 與公開網站之間唯一的介面；CMS 遷移至 AWS 時 Actions／Pages 不需修改」。這推翻了 baseline 架構圖的「GitHub Actions 讀取發布資料」。
- [Direct] 內容 repo 要私有的理由。PUB-002（addendum-02:33）：「Snapshot 若 commit 至公開 repo，封存與永久刪除的內容會永久留在公開 Git 歷史，與 Baseline 7.2、7.3 衝突。」同條也寫「內容 repo 的 commit 歷史即為已發布 Snapshot 的版本紀錄；重試與回滾以重新建置指定 commit 完成」。
- [Direct] PUB-003：完整全量輸出、REPEATABLE READ、圖片以內容雜湊命名、只輸出公開資料。
- [Direct] PUB-004 以「內容 repo 的 commit 順序與 HEAD 檢查」取代 baseline 未設計的鎖。
- [Direct] PUB-006：「內容 repo 只保存已發布 Snapshot，不能取代 CMS 備份」。
- [Direct] PUB-007（Accepted (delegated)）：永久刪除時不改寫內容 repo 歷史，理由是 repo 私有、`releases.content_commit` 會失效、既有 clone 要重新 clone。
- 來源標示：addendum-02:7「**來源**：Architecture Change Proposal B-01」。

### 合理推論

- 「Snapshot 是唯一介面」看起來是為了讓 CMS 的位置（本機或 AWS）不影響公開網站的建置路徑。PUB-001 的 consequence 直接寫了 AWS 那一半；「本機時 Actions 根本連不到 CMS」這一半是推論，但與「CMS 在作者本機執行」一致。
- README:169「the whole frontend could be replaced without touching the content.」是對外說法，與 PUB-001 一致，不是獨立證據。

### 其他可能的解釋

- 無。理由在 PUB-001、PUB-002 寫得很直接。

### 不知道的事

- Proposal B-01 的原文不在 repo（grep 全 repo 只有 addendum-02:7 的引用）。不知道 B-01 比較了哪些替代方案（例如 Actions 經 tunnel 讀 API、把 Snapshot 放 Object Storage）。

---

## 3. CMS（FastAPI + PostgreSQL + React SPA）先在本機，之後再上雲

### 找到的證據

- [Direct] 學習目標。baseline:27「透過自建 CMS／後端實際練習 FastAPI、資料模型、系統設計及可靠性設計」。
- [Direct] 本機執行。PUB-001：「V1 的 FastAPI CMS 與 PostgreSQL 在作者本機執行；之後可能遷移至 AWS」。後果：「作者電腦關機時無法發布；已部署網站不受影響（符合 Baseline 1.2）」，以及「CMS 僅在本機時仍須有管理員身分驗證…可先只綁定 `127.0.0.1`」。
- [Direct] PUB-005：「本機版的 CMS 只在寫作時啟動，不常駐…（使用者 2026-10-20 確認）」。2026-10-22 更新：維護工作改由 `python -m blog.maintenance`，「本機由 `start.sh`…雲端用排程」。
- [Direct] 上雲的連線方式選 Tailscale，並列出被否決的方案（old backlog:17-41，2026-10-22 作者決定）：
  - 「IP 白名單：家用與行動網路的 IP 會變，而且 IP 不代表身分。」
  - 「SSM port forwarding：每次都要先下指令，手機幾乎不能用。」
  - Cloudflare Access 或 AWS Verified Access：「CMS 會有公開網址」。
  - 用 MAC 位址限制：「做不到」。
- [Direct] 一份程式碼加 `.env`。old backlog:27「不開長期獨立的雲端分支。分支一分開，每個修正都要做兩次，CI 與部署也都綁在 `main`。」另寫「能用同一種做法同時適用兩邊的，就不做成選項」、「只有真的不同的地方才放進 `.env`，集中在一個設定模組讀取與檢查（A23）」。已轉錄為 BE-021（addendum-03:272）。
- [Direct] `cms-v*` tag。addendum-03:279「合併到 `main` 只部署公開網站，不更新雲端 CMS。推送 `cms-v*` tag 時才部署 CMS：先備份，再執行 migration，最後更新程式。」
- [Direct] 設定缺值不可默默退回本機預設。PR #29（A23）：「A missing value quietly fell back to a local default, which is unsafe in the cloud.」
- [Direct] PR #33：`cms-image.yml` 獨立出來，「so site deploys (which call `ci.yml`) don't wait for it」；`cms-v*` 部署 workflow 尚未寫，「It needs a host, and the compute service is still undecided.」
- [Direct] 運算服務未決（old backlog「需要先決定的事」）：單台 Lightsail 或 EC2「每月約 US$5–15」；Fargate + RDS + ALB「每月約 US$40 以上」；不用 Lambda，因為 6/10 MB 限制與 10 MB 上傳衝突。

### 合理推論

- 「本機優先」看起來同時滿足預算（不付主機費）與 Low Runtime Dependency（CMS 停機不影響讀者），所以上雲不急。這兩個前提都有出處，但沒有文字把它們連成「所以先本機」。
- PR #21 要求「Before the CMS moves to AWS, list every assumption that holds only because the CMS runs on 127.0.0.1.」顯示本機假設被視為上雲前要逐一清掉的債，而不是永久設計。

### 其他可能的解釋

- **FastAPI + PostgreSQL 是因為作者熟悉**：作者的自傳（Claude Docs）列出 FastAPI 與 PostgreSQL 技能及過去專案。與選型一致，但沒有寫成理由，屬推測。
- **FastAPI 是為了練習**：baseline:27 的學習目標支持這個說法。兩種解釋可能同時成立。

### 不知道的事

- 為何是 React SPA 而不是 server-rendered 管理頁，查不到理由。BE-006 只說同源讓 cookie session 不需處理 CORS。
- 何時、在什麼條件下上雲：addendum-02 的 Open Questions 仍列「遷移至 AWS 的條件與時機」。
- Tailscale 等 2026-10-22 決定的原始措辭不在 repo，repo 內是 agent 整理的摘要（見「決策來源與可信度」）。

---

## 4. 領域模型

### 4a. 工作草稿與已發布版本分表

#### 找到的證據

- [Direct] ART-020（Confirmed 2026-10-20，addendum-01:11-27）選方案 B（分表）。理由：
  - addendum-01:21「不可變性可由資料結構保證（例如對 PublishedVersion 禁止 UPDATE），不只依賴應用程式紀律。」
  - addendum-01:22「方案 A 若以「將草稿列改為已發布」實作 Publish，延遲的 Auto Save 會寫入已發布列；為避免此問題仍須複製，A 的「少表」優勢因此抵銷。」
  - 「「每篇一份草稿」可直接由 1:1 關聯保證」。代價：欄位重複。
- 方案 A（統一 ArticleVersion）與競態情境記在 baseline §13（baseline:368-399）。

#### 不知道的事

- 2026-10-11 前「前次助理傾向 B」（6f6f111 的 baseline 曾寫「**不可在下次直接視為已選 B；前次助理傾向 B 不代表使用者已接受。**」，271c7ed 移除）。使用者在哪次討論、以什麼措辭選 B，不在 repo。

### 4b. revision 與 409

#### 找到的證據

- [Direct] ART-021（addendum-01:36）：「Auto Save 請求必須附帶其基於的 `revision`；與伺服器現值不符時拒絕寫入（例如 HTTP 409），由前端重新載入草稿。」並註明「此問題與 A／B 的選擇無關，需獨立處理」。
- [Direct] BE-006（delegated）：前端單一佇列（`cms/src/draft-sync.ts`），遇 409「不自動合併」。BE-002（delegated）：發布時送出畫面上的完整內容，在鎖內一個交易完成。

### 4c. 封存、刪除、永久刪除

#### 找到的證據

- [Direct] baseline 7.1-7.3、ART-012..019（Confirmed）。30 天軟刪除「用途是保護誤刪，即使平時不預期頻繁復原」（baseline:241）；ART-019「再次確認 30 天 Soft Delete 為防止誤刪，沒有取消復原機制」。封存文章網址保留並顯示固定提示。
- [Direct] BE-005（delegated）：狀態機與 `retired_doc_ids`。

### 4d. 保留版本數

#### 找到的證據

- [Direct] baseline 6.3：保留 3 版，「不可立即清除舊版；應等新版本對應的靜態網站成功部署後」。
- [Direct] BE-011（delegated）四條件規則。BE-015（Confirmed 2026-10-20）是實際使用後發現的 bug：保留機制刪舊版後 `first_published_at` 跟著變動。

### 4e. ULID docId 網址

#### 找到的證據

- [Direct] baseline:136「使用者選擇 ULID 的主要理由：網址相對短，並避免把公開識別碼的語意耦合到特定資料庫。注意 UUID 也具跨資料庫能力，ULID 不是資料庫可攜性的唯一選項。」
- [Direct] baseline:145 可變 slug 與 Slug Redirect History「不再是現行公開文章路由需求」；baseline:146「`doc_id` 是公開識別碼，不是授權或私密存取憑證」。
- [Direct] baseline:253「公開 URL 長期固定，以減少失效外連、搜尋索引與 giscus 討論關聯變動」。FE-006：giscus 以 docId 嚴格對應，「改標題、網域或 basePath 都不會換到另一個討論串」。

#### 不知道的事

- ULID 與 UUID 的比較只有 baseline:136 這一段，沒有更細的取捨（例如時間排序是否被當作理由）。

### 4f. Topic／Tag 用 slug + name

#### 找到的證據

- [Direct] BE-003（delegated）是暫定做法：沿用已存在 slug 的名稱。
- [Direct] BE-013（Confirmed 2026-10-20）由真實事件觸發。addendum-03:166「第一篇測試文章的 Tag 名稱打錯，修正後重新發布仍顯示舊名稱…錯誤名稱無法修正會影響 SEO。」決定：「名稱屬於 Topic／Tag 本身…`published_version_tags` 只記錄引用，名稱不屬於版本內容」；「URL 由 slug 決定，改名不會改變網址」。
- [Direct] BE-019：合併 taxa 時改指已發布版本，「Topic／Tag／系列是誰屬於 Taxonomy 的身分，不屬於版本內容」（migration 0010）。Status：合併的版本處理「依 BE-013 的理由決定，使用者可推翻」；271c7ed 前寫的是「由 Claude 依 BE-013 的理由決定」。

### 4 整體：合理推論

- 4a、4b、4c、4e 的核心都是 Confirmed。4d、4f 有一部分是 delegated 草案，經「第一篇測試文章」的實際使用後才被修正（BE-013、BE-014、BE-015）。看起來 delegated 的細節比 Confirmed 的骨架更常變動，改這些地方前值得先問作者。

---

## 5. 發布狀態機與 `workflow_dispatch` 追蹤

### 找到的證據

- [Direct] baseline 9.1（baseline:291）「資料庫發布成功與網站部署成功是兩個不同事件；不能混為單一狀態」；Invariant 5（baseline:322）「**Deployment Awareness**：不能因 DB 已更新便宣稱公開網站已更新；必須追蹤線上部署狀態。」baseline 9.2「Latest State Wins」。
- [Direct] BE-010（delegated）：狀態、以 run-name 比對並容許 5 分鐘時鐘誤差、「V1 不自動重試」。
- [Direct] BE-016（delegated）：「git 與資料庫無法放在同一個交易」，所以匯出前先把路徑重設到 HEAD，並認領 `Release <id>` commit。
- [Direct] PR #28：用 run_id 判斷「because run ids only grow」；cancelled 對應 superseded，即「a queued run replaced by a newer one through `concurrency`」；更新狀態是 POST，「ends the database transaction first and writes with a conditional `UPDATE`」；30 分鐘後放棄。
- [Direct] `.github/workflows/deploy.yml:17-18` 註解：「One run at a time. A newer queued run replaces older queued ones, and a running build is allowed to finish (Baseline 9.2).」
- [Direct] PR #34：30 秒冷卻（A22）。

### 合理推論

- 狀態機的形狀由 Invariant 5 決定（Confirmed），但具體狀態與比對規則是 delegated。改狀態名稱或比對方式屬於可以和作者商量的範圍；把「DB 成功」與「部署成功」合併則違反 Confirmed 需求。

### 其他可能的解釋

- 關於選 `workflow_dispatch` 而不是 `repository_dispatch`：一種可能是 `workflow_dispatch` 能帶 inputs 並出現在 Actions 介面的手動觸發，便於追蹤 run-name；另一種可能是沒有特別比較。兩者都沒有證據。

### 不知道的事

- addendum-02 的 Open Question 只記「使用 `workflow_dispatch`，見 BE-010」，沒有寫為什麼不用 `repository_dispatch`。
- 「不自動重試」與 baseline 9.3 的暫定重試互相衝突（見「文件與程式不一致之處」）。

---

## 6. 文章不允許原始 HTML，網址採白名單，共用測試資料

### 找到的證據

- [Direct] FE-013（addendum-04:153，轉錄 old backlog:42-49 的 2026-10-22 作者決定）。Context（addendum-04:156）：「CMS 預覽與公開網站原本都會輸出文章裡的 HTML 與 `javascript:` 連結。預覽與 CMS 同源，貼上的內容一顯示就能帶著 session 發布或刪除文章。只跳脫 HTML 也不夠，`[x](javascript:...)` 是標準的 Markdown 語法。」之後需要影片或摺疊區塊時，「為那一種需求加專用的 Markdown 語法…不重新開放原始 HTML」。
- [Direct] old backlog G1：CMS 預覽會執行 `<img onerror>` 與 `javascript:`；「script 和 CMS 同源，帶著 session 可以發布、刪除文章，或觸發「更新網站」」；不需要 DOMPurify。G8：「公開網站沒有存放機密，所以影響限於頁面被竄改」。
- [Direct] commit 4ba8edf：作者確認現有文章都沒用原始 HTML。
- [Direct] PR #27：`frontend/.../url-policy.ts` 會解碼字元參照與 tab；CMS 有一份副本並以等值測試對齊；網址不合規時建置失敗；`/admin` 加 CSP。
- [Direct] 共用測試資料的範圍要分清楚：
  - `url-policy.json` 只由 frontend 與 CMS 共用。backend 沒有 url-policy 程式。
  - frontend 與 backend 共用的是 `image-refs.json`。BE-007：「後端（GC、Exporter）與前端（Snapshot 檢查）以同一份測試資料…確保規則一致」。起因是 PR #5：舊的正規表示式「6 wrong results in the backend and 5 in the frontend」。BE-004 以前端 parser 作為後端的契約測試。
  - FE-012（addendum-04:151）：「預覽與網站的 renderer 是兩份程式碼…修改其一時要同步另一份」。PR #35 加了 `shared-deps.test.ts`。

### 合理推論

- 「兩份程式碼加共用測試資料」看起來是刻意不抽共用套件的取捨，符合 AGENTS.md 的「Avoid premature abstraction」。但沒有文字說「為了不抽套件所以用共用 fixture」，這是推論。

### 不知道的事

- 2026-10-21 的 PR #13 寫「raw HTML in Markdown is allowed for the author」，隔天改成禁止。中間的討論在 Claude project thread，不在 repo。

---

## 7. 同一時間只有一個 CMS 寫入

### 找到的證據

- [Direct] old backlog A24（:192-193）：「本機 CMS 和雲端 CMS 各有自己的資料庫，卻都推送到同一個內容 repo。兩邊同時使用時，草稿和版本會分歧，而且後推送的一方會覆蓋或被拒絕。」並列出切換程序與防護。
- [Direct] PR #28 加入 `ls-remote` 防護。`backend/blog/release.py:218` 的訊息「another CMS may be in use」；`exporter.py:216-220` 同義。`docs/local-setup.md` §12「同一時間只用一個 CMS」。
- [Direct] `release.py:166-170` 的 advisory lock 註解：「Lets one release or retry run at a time, across requests and processes.」
- [Direct] 完整修正（A5，改用 Git Data API 且「parent 必須是目前的 HEAD」）仍未完成。

### 合理推論

- 這是「本機與雲端各一個 DB」的直接後果。若上雲後本機 CMS 不再寫入，這條限制可能就變成單純的操作規則。但目前沒有文件說本機 CMS 上雲後會停用。

### 不知道的事

- 是否考慮過讓兩邊共用同一個資料庫，查不到。

---

## 8. 漸進式搜尋索引

### 找到的證據

- [Direct] FE-002（delegated）：靜態搜尋，「不需要後端，不新增套件」（addendum-04:30）。fc327b0：單一 `search-index.json`、子字串比對，「so Chinese needs no segmentation」。
- [Direct] old backlog G14：「搜尋索引每篇最多保留 5000 字，而且一次全部載入。文章多時會變大」。
- [Direct] PR #53：問題是「首次搜尋會先下載所有文章內文，文章增加後會延後手機顯示結果」。取捨：「搜尋期間的篇數與排序會變動。分批載入縮小首批傳輸，全部內文的總傳輸量略增。」範圍外：「未加入分頁、Pagefind或首頁預載」。量測：手機模擬的標題搜尋中位數「15.13 s → 1.16 s」。變差的部分：最舊年份內文命中 15.08 → 16.71 s，總傳輸量 +0.82%，「不宣稱此項有改善」。
- [Direct] PR #55：移除 `search-index.json`；片語切分與去重，接受「a term that contains [CJK punctuation]… no longer matches body text」；年份用台北時區「to match the archive page」；版本檢查「because the metadata is fetched with `no-store` and a tab opened before a deploy can receive a newer format」。
- [Direct] FE-002 的 consequence：「若要再縮小，可改用只下載相關片段的搜尋套件」。

### 合理推論

- 不引入 Pagefind 這類套件，看起來延續 FE-002「不新增套件」與 AGENTS.md「Do not introduce dependencies without a clear reason」。PR #53 只寫 Pagefind 在範圍外，沒有寫為什麼。

### 不知道的事

- 量測是手機模擬，不是實機。#53 的 verifier 明說「does not promise continuously smooth mobile input, faster full downloads, or physical IME coverage.」
- 文章數到多少時要換成片段下載的套件，沒有門檻。

---

## 9. 安全設計

### 找到的證據

- [Direct] BE-009（delegated）：單一管理員、scrypt、伺服器端 session 只存 token 的 SHA-256、HttpOnly、SameSite=Strict、Origin 檢查作為「SameSite 之外的第二道 CSRF 防線」、連續 5 次錯誤鎖 15 分鐘「記憶體內計數，單一本機程序足夠」（addendum-03:119）。
- [Direct] BE-006：同源「讓之後的登入可以直接用 cookie session，不需處理 CORS」。
- [Direct] Host 檢查（PR #13、9aed1b1）。`backend/blog/api.py:88-91` 註解：網頁可以把自己的網域 rebind 到 127.0.0.1 連到 CMS，並打公開的 `/api/session` 猜密碼或觸發鎖定。A1 不允許 `*`，「以保留對 DNS rebinding 的防護」。
- [Direct] Origin 改比對 `CMS_ORIGIN`（A2、PR #29；`api.py:40-42`）。
- [Direct] CSP。`api.py:50-52`：「The CMS only loads its own scripts, so script injected through an article preview cannot run even if the renderer misses it.」A10 是 G1 之後的第二道防線；`/docs` 例外（Swagger 走 CDN）。
- [Direct] 每個位址的節流與退避（A3、PR #34），理由：「每 15 分鐘送 5 次錯誤密碼，作者就永遠無法登入」；「counted before scrypt runs, so concurrent guesses cannot get past the limit」。
- [Direct] A11：同時最多 2 個 scrypt（每個約 32 MiB）、密碼上限 1024 字元。A15：絕對 3 天、閒置 1 天、「登出所有裝置」。
- [Direct] BE-020（Confirmed 2026-10-22）：「放到雲端主機後，登入頁會對網際網路公開，而 CMS 只有一組密碼」；選 Tailscale；「不另外加 TOTP：通過核准的裝置是第一道驗證，密碼是第二道」（addendum-03:268）；「CMS 要開放給 tailnet 以外的網路時，必須重新評估第二道驗證」。
- [Direct] old backlog:20：「因為外人碰不到登入頁，以下項目已調降：A3、A4 由必修降為中，A10、A11 由高降為中，A15 由中降為低。A1、A2 和 A5–A8 與網路暴露無關，仍是必修。」
- [Direct] `__Host-` cookie 與 HSTS 只在 `COOKIE_SECURE` 開啟時生效（PR #29）。

### 合理推論

- 安全措施的優先順序明顯以「登入頁是否對外」為軸。改變網路暴露面（例如離開 tailnet）會讓 old backlog:20 調降過的項目重新變成必修，BE-020 也明寫要重新評估第二道驗證。

### 不知道的事

- BE-009 的細節（scrypt 參數、session 時長）是 delegated，沒有寫替代方案比較（例如 argon2）。

---

## 決策來源與可信度

這個專案的決策有兩種來源，可信度不同。改架構前先看要改的是哪一種。

### Confirmed：使用者明確選定

- baseline 0.1 定義「已確認」為「使用者已明確選定」，在「共同設計討論」中做成（baseline:6-14）。baseline 的「決策截止日：2026-10-11」。
- 清單：ART-020、ART-021；PUB-001..006、PUB-008；BE-012..015、BE-017..020；FE-004..012；old backlog 標「2026-10-22 作者決定」的項目（Tailscale、一份程式碼加 `.env`、`cms-v*` tag、不允許原始 HTML，後兩者已轉錄為 BE-021、FE-013）。

### Accepted (delegated)：作者授權採用助理建議

- 原文：addendum-03 在 20778dc 寫「使用者授權「剩下的架構規劃按助理建議」，以下標為 Accepted (delegated)。使用者可隨時推翻。」addendum-04 在 271c7ed 前寫「使用者授權依助理建議進行」。271c7ed 把兩者改寫成「由作者授權採用設計建議，作者可隨時推翻」（addendum-03:7、addendum-04:7）。
- 清單：PUB-007；BE-001..011、BE-016；FE-001、FE-002。
- 這些是 agent 提出、作者概括授權的設計，不是作者逐條選定。BE-013、BE-014、BE-015 都是 delegated 草案在「第一篇測試文章」實際使用後被修正的例子。

### 證據鏈的限制

- [Supported] repo 裡幾乎所有決策文字都由 agent 撰寫。6f6f111 之後的 commit 作者多為「Claude」或帶 Claude session footer；PR 描述註明 Generated by Claude Code；PR #26 寫「Requested by **Ray** · [project thread]」與「Ray chose this in the thread」。
- 因此「作者決定」「使用者指定」等項目是 agent 對 Claude project thread（`chan_01Szj7D66FxStLqYxnXLLHCb`）對話的摘要。作者的原始措辭不在 git。依 epistemics 規則，這些摘要能確認「作者做了決定」，但決定的精確範圍（例如「不允許原始 HTML」是否包含未來某些特定情境）只能以摘要為準，無法以原話確認。
- 同一份摘要被複製到 backlog、addenda、AGENTS.md 時，是同一條證據鏈，不是多個獨立確認。
- 2026-10-22 的 backlog 決策在 69a9cc0..4ba8edf 四個 commit 中、約 11 分鐘內寫入，看起來來自同一次對話。
- baseline 來自 2026-10-11 前更早的討論。6f6f111 時 baseline 仍寫「未經使用者確認的設計選項列為 Open Questions，不可混入 Confirmed Decisions.」，271c7ed 移除了這段交接文字。PR #1 的分支名 `claude/chatgpt-custom-gpt-link-o50ama` 暗示早期討論可能在 ChatGPT custom GPT，屬推測。

---

## 文件與程式不一致之處

以下各列出兩邊說法，不替任何一邊下結論。

1. **內容發布是否跑 CI。** PUB-004（addendum-02:73）：「Build 前先執行完整的 CI…CI 失敗即不建置、不部署（2026-10-21 使用者指定）。」PR #26（eaf3c90）：`workflow_dispatch` 的內容發布跳過 `ci` job，「Ray chose this in the thread」；AGENTS.md 已更新為「A content release from the CMS (`workflow_dispatch`) skips CI」。本分支已在 PUB-004 補上「2026-10-22 更新（#26，使用者選擇）」，記錄現行做法；原本的決策文字保留。
2. **原始 HTML。** PR #13（2026-10-21）：「raw HTML in Markdown is allowed for the author」。2026-10-22 作者決定與 FE-013：文章不允許原始 HTML。後者較新。
3. **自動重試。** baseline:308「先前討論的「最多約三次」仍為暫定值」，並提到 email 通知。BE-010：「V1 不自動重試」，通知改靠 GitHub 的 email（PUB-005）。
4. **GC 時程。** baseline:275「**每週五**一次」。PUB-005、BE-007：啟動時執行並補跑錯過的；2026-10-22 更新為「雲端用排程」。
5. **登入鎖定。** BE-009 仍寫「連續 5 次密碼錯誤後鎖定 15 分鐘（記憶體內計數…）」。PR #34（A3）已改為每個位址的資料庫計數加退避，理由是全域鎖定會讓作者永遠無法登入。本分支已在 BE-009 補上「2026-10-22 更新（#29、#34）」，記錄現行的節流與 session 規則；原本的決策文字保留。
6. **匯出路徑。** PUB-003 寫先寫入暫存目錄。BE-016 改為匯出前把路徑重設到 HEAD。

處理狀況：1 與 5 已在本分支以「更新」註記補上現行做法，只描述程式現況，沒有改寫原決策。3、4、6 是 baseline 與 addendum 的差異，依規格文件慣例 baseline 不改，以較新的 addendum 為準。

---

## 查過的來源

- **原始碼控制**：讀完 baseline、addenda 01-04、`docs/backlog.md`（現行與 `main` 舊版）、`docs/cloud-access.md`、`docs/maintainer-notes.md`、`docs/fork-and-deploy.md`；`git log --reverse`（2026-10-11 起 184 個 commit）、`git log -- docs/design`；`git show` 6f6f111、be18207、05628de、20778dc、271c7ed、fe28091、2af367e、fc327b0、69a9cc0、3df1445、0ae1dcb、4ba8edf、a6cf420、eaf3c90、9aed1b1、8f4c0e5；PR #1、2、5、13、16、17、18、21、22、26、27、28、29、31、33、34、35、51、53、55 的描述、留言與 review；`config.py`、`api.py`、`auth.py`、`release.py`、`exporter.py`、`deploy.yml` 的註解；grep `url-policy`、`image-refs`；README「Advantages」。
- **Issue／工單**：GitHub Issues 已查，`gh issue list --state all` 為空。沒有其他工單系統。
- **長篇文件**：Claude Docs 共 3 份全數列出。讀完「部落格待開發功能盤點」與「部落格可擴充項目（第二輪）」（皆 2026-10-21，無留言串），兩者都說自己整理自 `main` 與 `docs/` 規格，只有次要的重述（例如排程發布「不建議」，因 CMS 不常駐）。第三份自傳以關鍵字搜尋 17 處命中，皆與部落格架構無關。
- **即時聊天**：未搜尋。沒有對應的 MCP。決策對話所在的 Claude project thread 也無法搜尋。
- **基礎設施觀測**：未搜尋。沒有對應的 MCP；本專案沒有執行期遙測。
- **錯誤追蹤**：未搜尋。沒有對應的 MCP。
- **產品分析**：未搜尋。沒有對應的 MCP。

本文撰寫時另外抽查了以下引文與原始來源一致：baseline:34、38、82、136、275、308、322、325；addendum-01:21-22、36；addendum-02:7、20、33、73；addendum-03:7、119、166、268、272-280；addendum-04:30、151、153-156；20778dc 的授權原文；271c7ed 的 commit 訊息；old backlog:20-27、44、192-193；`api.py` 第 50、88 行註解；`deploy.yml:17-18`；`release.py:218`；PR #13、#26、#33、#53 的引文。

### 整體可信度

「為什麼靜態、為什麼私有內容 repo、為什麼分表、為什麼 ULID、為什麼禁止原始 HTML、為什麼 Tailscale」都有直接的書面理由。發布狀態機、搜尋、多數安全細節屬 delegated，理由由 agent 寫成並經作者概括授權。託管平台與框架選型、`workflow_dispatch` 對 `repository_dispatch`、Proposal B-01 的替代方案則查不到理由。所有作者決定都只有 agent 摘要，沒有作者原話。

---

## 改架構前的檢查清單

### Preserve（有 Confirmed 理由，改之前先問作者）

- 公開閱讀不依賴後端（Invariant 8）、靜態全站建置（baseline 2.2）。
- Snapshot 是 CMS 與網站之間唯一的介面，GitHub Actions 不連 CMS 或 DB（PUB-001）。
- 內容 repo 保持私有（PUB-002）。
- 草稿與已發布版本分表、已發布版本不可 UPDATE（ART-020）；Auto Save 帶 `revision`，不符回 409（ART-021）。
- `doc_id` 網址固定，giscus 以 docId 對應（baseline 4.1、7.4、FE-006）。
- Taxa 名稱屬於 taxa 本身，網址由 slug 決定（BE-013）。
- DB 發布成功與網站部署成功分開追蹤（Invariant 5）。
- 文章不允許原始 HTML，網址走白名單（FE-013）。
- 一份程式碼加 `.env`，不開長期雲端分支；`cms-v*` tag 才部署 CMS（BE-021）。

### Change（delegated 或已知過時，可以提出修改）

- baseline 9.3 重試、baseline 8.3 GC 時程：baseline 不改，以較新的 addendum（BE-010、PUB-005）為準。BE-009 與 PUB-004 已補上更新註記。
- 搜尋改用片段下載套件（FE-002 已預留這條路）。
- 狀態機細節（BE-010）、匯出流程（BE-016）、保留規則（BE-011）都是 delegated，作者明說可推翻。

### Avoid

- 不要把 agent 摘要的「作者決定」當成作者原話去推論更大的範圍。範圍不清時問作者。
- 不要在 frontend、CMS、backend 間抽共用套件來取代共用測試資料，除非先討論；目前做法是兩份程式碼加 `url-policy.json`、`image-refs.json` 與等值測試。
- 不要從雲端 session 對內容 repo commit 或手動觸發 `Deploy site`（AGENTS.md）。

### Risk

- 本機與雲端 CMS 同時寫入會讓內容分歧；目前只有 `ls-remote` 防護，完整修正（A5）未做。
- 離開 tailnet 或公開登入頁時，old backlog:20 調降的 A3、A4、A10、A11、A15 會重新變成必修，BE-020 要求重新評估第二道驗證。
- preview renderer 與網站 renderer 是兩份程式碼，只改一份會造成預覽與上線結果不同（FE-012）。
- `CONTENT_REPO_TOKEN` 有到期日；部署失敗時先查它（`docs/maintainer-notes.md`）。
