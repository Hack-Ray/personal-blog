# 待辦事項

這份清單記錄已知但還沒修的問題。完成一項就勾選，並寫上處理它的規格編號或 commit。新發現的問題加在對應分類的最後。

2026-10-21 依 `main` 4c8a432 全面盤點一次，分四個面向：登入與請求安全、發布流程、部署與維運、CMS 與公開網站。每一項都附上程式位置；標 **推測** 的項目是依程式碼推論，沒有實際執行驗證。

優先順序：

- **必修**：不修就不能上 AWS，或已經會造成資料遺失或錯誤狀態。
- **高**：上線前應該修。
- **中**、**低**：排進之後的工作。

## 需要先決定的事

以下決定會影響第二節的優先順序與做法。

- [x] **CMS 上 AWS 後的存取控制：用 Tailscale。**（2026-10-22 作者決定）
  - 主機的 Security Group 不開任何進站 port。主機只主動連出到 Tailscale，CMS 只有登入作者的 Tailscale 帳號、經作者核准的裝置連得到。
  - CMS 原本的密碼登入保留，作為第二層。
  - 因為外人碰不到登入頁，以下項目已調降：A3、A4 由必修降為中，A10、A11 由高降為中，A15 由中降為低。A1、A2 和 A5–A8 與網路暴露無關，仍是必修。實作見 A0；設定切換見 A23、A24。
  - 考慮過的其他做法：
    - IP 白名單：家用與行動網路的 IP 會變，而且 IP 不代表身分。
    - SSM port forwarding：每次都要先下指令，手機幾乎不能用。
    - Cloudflare Access 或 AWS Verified Access：CMS 會有公開網址。
    - 用 MAC 位址限制：做不到，MAC 位址不會跨路由器傳到 AWS。
- [x] **本機與雲端用同一份程式碼，以 `.env` 切換。**（2026-10-22 作者決定）
  - 不開長期獨立的雲端分支。分支一分開，每個修正都要做兩次，CI 與部署也都綁在 `main`。
  - 原則一：能用同一種做法同時適用兩邊的，就不做成選項。例如發布改用 GitHub API（A5），定期維護做成同一個指令（A7）。
  - 原則二：只有真的不同的地方才放進 `.env`，集中在一個設定模組讀取與檢查（A23）。fork 這個專案的人也能自己選本機或雲端。
- [x] **雲端 CMS 以 tag 觸發部署。**（2026-10-22 作者決定）
  - 合併到 `main` 只部署公開網站，不更新雲端 CMS。
  - 推送 `cms-v*` tag 時才部署 CMS：先備份，再執行 migration，最後更新程式（A6）。
  - 部署 workflow 透過 Tailscale 的 GitHub Action 連到主機，主機仍然不開進站 port。
- [ ] **發布方式。** 二選一：
  - 在容器裡維護內容 repo 的 git clone。
  - 改用 GitHub Git Data API 直接建立 commit，不需要本機 clone，CMS 可以不保存狀態。建議用這個（見 A5）。
- [ ] **GitHub 憑證。** 目前 CMS 用兩個 token：一個觸發 workflow，一個 push 內容 repo（後者現在借用作者電腦上的 git 帳號）。建議改成一個 GitHub App，token 會自動輪替（見 A12）。
- [ ] **運算服務。** 候選：ECS Fargate、App Runner、EC2 或 Lightsail。
  - 搭配 Tailscale，建議先用單台 Lightsail 或 EC2 執行 Tailscale、CMS 與 Postgres，資料庫備份到 S3。每月約 US$5–15（概估，以 AWS 定價為準）。
  - Fargate + RDS + ALB 每月約 US$40 以上，而且要在容器裡跑 Tailscale，等熟悉後再考慮。
  - 不建議 API Gateway + Lambda：它們的請求大小上限是 10 MB 和 6 MB，而圖片上傳允許到 10 MB。
- [x] **文章不允許原始 HTML。**（2026-10-22 作者決定）
  - 文章裡的 HTML 一律跳脫成純文字顯示。CMS 預覽、公開網站的 renderer 和 build 時的檢查都用這一條規則。
  - 只跳脫 HTML 還不夠，`[x](javascript:...)` 是標準的 Markdown 語法。因此另外加網址白名單：
    - 連結只允許 `https:`、`http:`、`mailto:`、`#` 錨點和相對路徑。
    - 圖片只允許 `images/` 開頭的路徑和 `https:`。
    - 其他網址不輸出成連結或圖片。build 時遇到就讓建置失敗，CMS 發布前檢查也要擋下來。
  - 之後需要嵌入影片或摺疊區塊時，為那一種需求加專用的 Markdown 語法，由 renderer 產生固定的 HTML，不重新開放原始 HTML。
  - 實作見 G1、G8、G15。現有文章已確認沒有使用原始 HTML。

## 一、現在就該修

這些問題和是否上 AWS 無關。

- [x] **G1（高）CMS 預覽會執行文章裡的 HTML 與 `javascript:` 連結。**（#27）
  - 證據：
    - `cms/src/editor.tsx:236` 和 `cms/src/profile-page.tsx:179` 用 `dangerouslySetInnerHTML` 輸出預覽。
    - `cms/src/preview.ts:52` 只判斷是否為外部連結，沒有限制 scheme。
    - 實測 `[x](javascript:alert(1))` 與 `<img src=x onerror=...>` 都會原樣輸出。
  - 影響：貼上的內容一顯示預覽就會執行 script。script 和 CMS 同源，帶著 session 可以發布、刪除文章，或觸發「更新網站」。
  - 處理：
    - `cms/src/preview.ts` 的 renderer 跳脫所有 `html` token，並套用「文章不允許原始 HTML」的網址白名單，不需要另外加 DOMPurify。
    - `/admin/` 加 CSP（見 A10）。
- [x] **G2（高）文章編輯器沒有離開提示，存檔失敗也不會重試。**（#24、#30）
  - 證據：
    - 只有 `profile-page.tsx:82` 註冊了 `beforeunload`，`editor.tsx` 沒有。
    - `cms/src/draft-sync.ts` 存檔失敗後把狀態設回 dirty，但不排程重試，要等下一次按鍵才會再存。
    - Topic 不合法時，修改完全不送出（`editor.tsx:54`）。
  - 影響：以下三種情況，關掉分頁就會遺失修改：
    - 最後 1 秒內的輸入。
    - Topic 不合法期間寫的所有內容。
    - 存檔失敗後沒有再打字。
  - 處理：
    - 狀態不是「已儲存」時加 `beforeunload` 提示。
    - 非 401、409 的錯誤，以退避間隔自動重試。
- [x] **G3（高）重試失敗的 release 時，會被舊的 workflow run 判成失敗。**（#28）
  - 證據：
    - `backend/blog/release.py:201`：`find_run` 以 `release.created_at` 為起點，挑名稱符合的最新 run。
    - 重試會重新觸發同一個 commit，但沒有記錄新 run 的 id（`release.py:157` 只清掉 `run_url`）。
    - CMS 按下重試後會立刻重新讀取 release 狀態。
  - 影響（**推測**）：GitHub 建立新 run 有幾秒延遲。這段時間內只找得到舊的失敗 run，release 就被標成 `failed`。`failed` 之後不再更新，所以網站實際上線了，CMS 仍顯示失敗。
  - 處理：`releases` 加 `run_id` 欄位，重試時忽略舊的 run id。找到 run id 後，改用 `GET /actions/runs/{id}` 直接查狀態。
- [x] **G4（中）停在 `exported` 或 `pushed` 的 release 無法重試，也無法被取代。**（#28）
  - 證據：
    - `release.py:25`：`RETRYABLE` 只有 `push_failed`、`dispatch_failed`、`failed`。
    - `create` 只會把 `exported` 和可重試的狀態標成 `superseded`。
    - HEAD 已有對應的 release 時，「更新網站」會回應沒有變更。
  - 影響：push 完、觸發部署前程式結束，該 release 永遠停在 `pushed`，那批內容不會上線。CMS 每 15 秒輪詢一次，而且一直輪詢下去。這次 release 的版本也會一直被版本清理排除。
  - 處理：`RETRYABLE` 加上 `exported` 與 `pushed`（`_advance` 已能處理這兩個狀態）；`create` 也取代 `pushed`。
- [x] **G5（中）開著的編輯器存檔時，會還原分類的改名或合併。**（#24）
  - 證據：
    - `backend/blog/articles.py:105`：每次存檔都以 `on_conflict_do_update` 寫回編輯器手上的分類名稱。
    - `backend/blog/taxa.py` 改名、合併時不會遞增草稿的 revision。
  - 影響：在分類頁把「Backend」改名後，另一個分頁的編輯器下一次自動存檔，就把名稱改回去，已發布的版本也一起受影響。合併時，舊的 slug 會被重新建立。
  - 處理：改名、合併時遞增受影響草稿的 revision，讓舊分頁收到 409 後重新載入。
- [x] **G6（中）草稿衝突時按「重新載入」，會直接丟掉本機修改。**（#24）
  - 證據：`editor.tsx:135-141` 的提示沒有說明會捨棄修改，也沒有確認步驟。設定頁的同類提示有寫（`profile-page.tsx:144`）。
  - 處理：重新載入前先確認，並把本機的 Markdown 複製到剪貼簿或存成快照。
- [x] **G7（中）排隊中被取消的 workflow run 被記成失敗。**（#28）
  - 證據：
    - `deploy.yml` 的 `concurrency` 會讓較新的 run 取代排隊中的舊 run。
    - `release.py:207-208` 把所有非 `success` 的結果都記成 `failed`。
  - 處理：結果為 `cancelled` 時記成 `superseded`。
- [x] **G8（中）公開網站不過濾文章裡的原始 HTML 與 `javascript:` 連結。**（#27）
  - 證據：
    - `frontend/src/content/markdown.ts:45-46` 和 CMS 預覽一樣，不檢查 scheme。
    - `frontend/src/app/article-body.tsx:116-117` 用 `dangerouslySetInnerHTML` 輸出。
  - 影響：能寫入內容 repo 或 CMS 的人，可以在每位讀者的頁面執行 script。公開網站沒有存放機密，所以影響限於頁面被竄改。
  - 處理：
    - `frontend/src/content/markdown.ts` 的 renderer 跳脫所有 `html` token，並套用和 CMS 相同的網址白名單。
    - `frontend/src/content/parse.ts` 遇到不在白名單上的網址時讓 build 失敗。
    - 白名單的測試案例放在一份前後端共用的 fixture，做法比照 `frontend/test-fixtures/image-refs.json`，避免兩邊的規則分歧。
- [x] **G9（中）文章目錄的標題 id 可能重複，或和頁面上原有的 id 相同。**（#50）
  - 證據：
    - `frontend/src/content/headings.ts:39-41` 只收集最上層的標題，`markdown.ts:60-64` 卻會替引言區塊、清單裡的標題也分配 id。
    - 頁面本身已經有 `id="toc"`（`article-toc.tsx:31`）。
    - 實測 `headings("> ## Setup\n\n## Setup\n\n## TOC")` 會產生 `setup` 與 `toc` 兩個 id，與 renderer 分配的不一致。
  - 處理：讓目錄和 renderer 用同一套方式收集標題，並避開頁面已經使用的 id。
- [x] **G10（中）建置與相依套件的版本沒有固定。**（#35）
  - 證據：
    - workflow 用 `node-version: 22`，但直接執行 `.ts` 需要 Node 22.18 以上。repo 裡沒有 `.nvmrc` 或 `engines`。
    - Python 只寫 `>=3.12`，沒有 `.python-version`。
    - Python 沒有 ruff 之類的 lint。
    - 沒有 Dependabot。
    - `frontend` 與 `cms` 各自固定 `marked` 和 `shiki` 的版本，沒有檢查兩邊是否一致。
  - 處理：
    - 加 `.nvmrc` 與 `.python-version`，CI 讀取這兩個檔案。
    - 加 `ruff check`。
    - 加 `.github/dependabot.yml`。
    - 加一項檢查，確認兩邊的共用套件版本相同。
- [x] **G11（低）`deploy.yml` 的權限比需要的大，CI 也重複執行。**（#35）
  - 證據：
    - `deploy.yml:14-17` 在最上層授予 `pages: write` 與 `id-token: write`，所以 `build` job 也拿得到。
    - `ci.yml` 對每次 push 都執行，再加上 `pull_request`，同一個分支會跑兩次。
    - `deploy.yml` 的 `build` job 又重跑了 `npm test` 和 `typecheck`。
  - 處理：
    - 兩個權限只授予 `deploy` job。
    - `ci.yml` 的 `push` 只限 `main`。
    - 刪掉 `build` job 裡重複的步驟。（已完成：`build` 改為與 `ci` 並行，重複的 `npm test` 與 `typecheck` 已刪除。）
- [x] **G12（低）本機啟動與還原腳本。**（#31）
  - `backend/scripts/start.sh:18-23`：備份失敗時仍然執行 migration。應改成備份失敗且有待執行的 migration 時，停止啟動。
  - `backend/scripts/restore.sh:49-52`：沒有讀取 `.env`，資料庫埠改過時，migration 會連到錯誤的資料庫。
- [x] **G13（低）CMS 小問題。**（#24）
  - 發布頁的錯誤訊息用綠色的成功樣式顯示（`cms/src/releases.tsx:524,547`）。
  - 設定頁切換到其他頁面時，未儲存的修改沒有提示（`profile-page.tsx:79-84`）。
  - 登入畫面沒有擋住後面的頁面：缺 `inert` 和 `aria-modal`（`main.tsx:594-601`）。
  - 登出失敗時沒有任何提示（`article-list.tsx:104`）。
  - 發布時沒有檢查文章引用的圖片是否存在。目前要到匯出時才失敗，而且整站都無法發布（`articles.py:364`）。
- [ ] **G14（低）公開網站小問題。**（部分完成：#50 完成搜尋索引以外的部分；搜尋索引的大小等文章變多再處理）
  - 深色模式沒有設定 `color-scheme`，原生輸入框和捲軸仍是淺色（`frontend/src/app/globals.css`）。
  - 圖片放大只能用滑鼠點；小圖放大後會模糊（`article-body.tsx:36`、`globals.css:591-595`）。
  - 複製按鈕和頁首搜尋的結果數量，沒有用 `aria-live` 通知螢幕閱讀器。
  - 摘要沒有去除原始 HTML 標籤，而且以 UTF-16 截斷，可能把 emoji 切壞（`frontend/src/content/summary.ts`）。
  - RSS 缺 `atom:link rel="self"`；列表頁和首頁沒有預設的分享圖。
  - 搜尋索引每篇最多保留 5000 字，而且一次全部載入。文章多時會變大，404 頁只顯示 5 個標題也要載入整份（`frontend/src/content/search.ts`）。
  - 「關於」頁與頁尾用內容當 React key，內容重複時會出現警告。

- [x] **G15（低）發布前警告文章含有原始 HTML。**（#27）
  - 現有文章已確認沒有使用原始 HTML（2026-10-22 作者確認），所以 G1、G8 可以直接上線，不會改變現有文章的顯示。
  - 處理：CMS 的發布前檢查（`cms/src/publish-checks.ts`）加一條警告：「這篇文章含有原始 HTML，發布後會顯示成純文字」。這是為了之後貼上的內容。

## 二、上 AWS 前必修

除非另外註明，這些項目在本機都不成立或影響很小。存取控制已決定用 Tailscale，以下的優先順序已依此調整。

### 必修

- [x] **A0 用 Tailscale 隔離 CMS。**（#DOCS，見 `docs/cloud-access.md`）
  - 主機的 Security Group 進站規則全部移除，包括 SSH。管理主機改用 Tailscale SSH 或 SSM。
  - 用 `tailscale serve` 提供 HTTPS。它會向 Tailscale 取得 `*.ts.net` 憑證，再轉給只綁定 `127.0.0.1:8000` 的 uvicorn，所以 uvicorn 不用改成 `0.0.0.0`。
  - Tailscale ACL 只允許作者的裝置連到 CMS 主機，並開啟新裝置核准（device approval）。
  - 主機的節點金鑰關閉到期，作者自己裝置的金鑰保留到期，並寫下裝置遺失時的撤銷步驟。
  - 文件：更新 `docs/local-setup.md` 或新增雲端部署文件，以及 Addendum 03 的部署決策。

- [x] **A23 設定模組與 `CMS_ENV`。**（#29）
  - 現況：設定分散在各模組，用 `os.environ.get` 讀取，缺值時默默使用本機預設（`api.py:33`、`backend/blog/db.py`、`release.py:118-132`）。
  - 處理：
    - 新增一個設定模組，啟動時一次讀取並檢查全部設定。缺少必填值或格式不對時，直接啟動失敗。
    - `CMS_ENV=local|cloud` 只決定下列各項的預設值，每一項都可以用環境變數個別覆寫：

      | 設定 | `local` 預設 | `cloud` 預設 |
      | --- | --- | --- |
      | `ALLOWED_HOSTS` | `127.0.0.1,localhost` | 必填，例如 `cms.<tailnet>.ts.net` |
      | `CMS_ORIGIN` | `http://127.0.0.1:8000` | 必填，例如 `https://cms.<tailnet>.ts.net` |
      | `COOKIE_SECURE` | 關 | 開 |
      | `DATABASE_URL` | Docker 的 Postgres | 必填 |
      | `BACKUP_TARGET` | `backend/backups/` | 必填，例如 `s3://<bucket>/cms/` |
      | `ENABLE_DOCS` | 開 | 關 |

    - `.env.example` 分成本機與雲端兩段範例，`docs/local-setup.md` 說明各項設定。
  - A1、A2、A9 都依賴這個模組，建議最先做。
- [x] **A24 同一時間只能有一個 CMS 在寫入。**（#28）
  - 原因：本機 CMS 和雲端 CMS 各有自己的資料庫，卻都推送到同一個內容 repo。兩邊同時使用時，草稿和版本會分歧，而且後推送的一方會覆蓋或被拒絕。
  - 處理：
    - 寫下切換流程：
      1. 在原本的 CMS 備份。
      2. 把備份還原到新的 CMS。
      3. 停用原本的 CMS。

      切回來時反向進行。
    - 加一道防呆：「更新網站」前比對內容 repo 的 HEAD，是不是這個資料庫最後一筆 release 的 commit。不是的話，拒絕發布並提示「另一個 CMS 可能在使用中」。
    - 搭配 A5 的「parent 必須是目前的 HEAD」，兩個 CMS 同時推送時，後推送的一方會失敗，不會覆蓋。
- [x] **A1 Host 白名單寫死成 localhost。**（#29）
  - 證據：`backend/blog/api.py:55`，`allowed_hosts=["127.0.0.1", "localhost"]`。
  - 影響：所有經過網域或 Load Balancer 的請求都會收到 400，健康檢查也會失敗。
  - 處理：
    - 白名單改從環境變數 `ALLOWED_HOSTS` 讀取，預設維持現值，不允許 `*`，以保留對 DNS rebinding 的防護。
    - 健康檢查使用不經過這項檢查的路徑（見 A16）。
    - 用 Tailscale 時，`ALLOWED_HOSTS` 要加上 CMS 主機的 MagicDNS 名稱（例如 `cms.<tailnet>.ts.net`）。
- [x] **A2 放在 HTTPS proxy 後面時，Origin 檢查會拒絕所有寫入，包括登入。**（#29）
  - 證據：`api.py:43` 用 `request.url.scheme` 和 `netloc` 組出預期的 Origin。uvicorn 預設只信任來自 127.0.0.1 的 `X-Forwarded-Proto`。
  - 影響：瀏覽器送出 `Origin: https://…`，伺服器卻組出 `http://…`，所有寫入都回 403。
  - 處理：改成和設定值 `CMS_ORIGIN` 比對。`FORWARDED_ALLOW_IPS` 只設定為 proxy 所在的網段。
  - 用 Tailscale 時，`CMS_ORIGIN` 是 `https://cms.<tailnet>.ts.net`。`tailscale serve` 從 127.0.0.1 轉發請求，uvicorn 預設就信任它送來的 `X-Forwarded-Proto`，所以只改成比對 `CMS_ORIGIN` 可能就夠了（**推測**，要實測 `tailscale serve` 送出的標頭）。
- [ ] **A5 發布依賴本機的內容 repo clone，而且沒有序列化。**（部分完成：#28 完成鎖、逾時與錯誤訊息；改用 Git Data API 與背景工作等發布方式決定）
  - 證據：
    - `release.py:130-132` 讀取 `CONTENT_REPO_DIR`。
    - `backend/blog/exporter.py` 會 `git commit`、`git push`，但從不 fetch，也只和 working tree 比較。
    - git 身分和 push 憑證都沿用作者電腦上的設定（`docs/fork-and-deploy.md` 第 2 步）。
    - `api.py:324-332` 的「更新網站」在請求內同步執行，沒有任何鎖。
  - 影響：
    - 新容器沒有 clone，回 503；沒有 git 身分，`git commit` 失敗。
    - 兩個 instance，或本機與雲端同時使用時，push 會因為 non-fast-forward 被拒絕，而且重試也永遠失敗。
    - 兩次同時發布會互相刪掉對方寫到一半的檔案，或寫入相同的主鍵而回 500。
    - Load Balancer 的閒置逾時（ALB 預設 60 秒）比 push 還短時，作者看到逾時，可能再按一次（**推測**）。
  - 處理：
    - 建議：改用 GitHub Git Data API 建立 commit，以「parent 必須是目前的 HEAD」為條件更新 ref。這樣 CMS 不需要本機 clone，本機與雲端用同一種做法，不需要設定切換。
    - 發布與重試用 Postgres advisory lock 序列化，鎖被佔用時回 409。
    - 改成背景工作，請求立刻回 202。
    - git 子程序加逾時。
- [x] **A6 沒有 CMS 的容器映像檔和部署流程，也沒有指定由誰執行 migration。**（#33；`cms-v*` 部署 workflow 等運算服務決定後再做）
  - 證據：
    - repo 裡沒有 Dockerfile。
    - `backend/compose.yaml` 只有資料庫。
    - `deploy.yml` 只部署公開網站。
    - migration 只在 `start.sh` 裡、備份之後執行。
  - 處理：
    - 寫 multi-stage Dockerfile：先用 Node 建置 `cms/dist`，再 `uv sync --locked --no-dev`；包含 git，以非 root 執行。
    - 每次部署前，用一次性的工作先備份，再執行 `alembic upgrade head`。
    - 只跑一個 instance。
    - 部署由 `cms-v*` tag 觸發，和公開網站的部署分開。workflow 用 Tailscale 的 GitHub Action 連到主機，依序備份、migration、更新程式；任何一步失敗就停止。
    - 本機繼續用 `start.sh`，流程相同：先備份，再 migration，再啟動。
- [x] **A7 定期維護只在程式啟動時執行。**（#31）
  - 證據：`api.py:20-27` 的 lifespan 是 `purge_expired`、`cleanup_versions`、`collect_garbage` 唯一的定期呼叫點。
  - 影響：
    - CMS 長時間執行時，待刪除超過 30 天的文章不會被清除；`purge_after` 已經過期，資料仍然留著。
    - 圖片 GC 也不會執行。
    - 多個 instance 同時啟動時，`collect_garbage` 會鎖住四張表，擋住所有存檔。
  - 處理：
    - 把三個工作移到 `python -m blog.maintenance`。本機由 `start.sh` 在啟動時呼叫一次，雲端用排程呼叫（單台主機用 systemd timer 或 cron，用 ECS 時用 EventBridge）。程式碼只有一份。
    - 用 `pg_try_advisory_lock` 確保同一時間只有一個執行。
    - PUB-005「只在 CMS 啟動時執行」改為「本機在啟動時執行，雲端用排程執行」。
- [x] **A8 CMS 長時間執行時沒有備份。**（#31）
  - 證據：備份只在 `start.sh:17-20` 執行，而且放在本機資料夾。
  - 處理：
    - `backup.sh` 與 `restore.sh` 本機與雲端共用。只把「存到哪裡」改成讀取 `BACKUP_TARGET`（A23），可以是本機資料夾或 `s3://` 位址。兩邊用相同的 sha256 檢查碼與 `pg_restore --list` 驗證。
    - 本機：照現在的做法，啟動時備份到資料夾（可以連到 Google Drive）。
    - 雲端：每天排程備份到 S3。S3 開啟版本控制與加密，設定保存天數。
    - 用 RDS 時，另外開啟自動備份、point-in-time recovery 與刪除保護。
    - 定期實際演練還原，包括 A24 的切換流程。

### 高

- [x] **A9 `COOKIE_SECURE` 和 `DATABASE_URL` 缺設定時，會默默用不安全的預設值。**（#29）
  - 證據：
    - `api.py:33` 只有在環境變數為 `"1"` 時才設 Secure。
    - `backend/blog/db.py` 缺 `DATABASE_URL` 時，退回 `blog:blog@127.0.0.1`。
  - 處理：
    - 非本機環境預設開啟 Secure，cookie 改名為 `__Host-cms_session`，並加 HSTS。
    - 缺 `DATABASE_URL` 時直接啟動失敗。
- [ ] **A12 三個憑證裡只有一個有到期提醒。**（部分完成：#29 只完成改名；其餘等 GitHub 憑證決定）
  - 證據：
    - `.github/workflows/token-expiry.yml` 只檢查 `CONTENT_REPO_TOKEN`。
    - CMS 的 `GITHUB_TOKEN` 只在打開發布頁時檢查。
    - 推送內容 repo 的憑證完全沒有檢查。
  - 處理：
    - 建議改成一個 GitHub App，存進 Secrets Manager。
    - 或改成排程檢查並寄信通知。
    - 環境變數 `GITHUB_TOKEN` 改名為 `CMS_GITHUB_TOKEN`，避免和 `gh` 等工具使用的變數衝突。

### 中

- [x] **A3 任何人都能讓作者無法登入。**（#34）（原為必修；有 Tailscale 後，只有作者的裝置碰得到登入頁）
  - 證據：
    - `backend/blog/auth.py:60-81` 的 `Throttle` 存在記憶體裡，全站共用一個計數。
    - `api.py:168` 在鎖定期間連正確的密碼也拒絕。
  - 影響：
    - 每 15 分鐘送 5 次錯誤密碼，作者就永遠無法登入，只能重啟程式。
    - 有多個 instance 時，可以嘗試的次數乘上 instance 數。
    - 先檢查再計數的寫法，在併發請求下會讓實際嘗試次數超過 5 次。
  - 處理：
    - 失敗紀錄存進資料庫，依來源 IP 計算，改用退避而不是全站鎖定。
    - 計數在檢查密碼之前原子地遞增。
- [x] **A4 只有一組密碼，沒有第二道驗證。**（#DOCS：以 Tailscale 為第一道驗證，暫不加 TOTP）（原為必修）
  - 證據：`auth.py:88-100`。
  - 影響：密碼外洩後，攻擊者可以發布內容、永久刪除文章，並部署網站。
  - 處理：Tailscale 已是第一道驗證（裝置金鑰）。之後若要再加強，可以加 TOTP。
- [x] **A10 `/admin/` 與 `/api/` 沒有安全標頭，OpenAPI 文件也公開。**（#27、#29）（原為高；CSP 仍是 G1 的第二道防線，可以和 G1 一起做）
  - 證據：
    - 實測 `/admin/` 只回傳 content-type 等基本標頭。
    - `api.py:30` 沒有關閉 `docs_url`、`redoc_url`、`openapi_url`，不登入就能存取 `/docs`、`/openapi.json`。
  - 處理：
    - 加一個 middleware，輸出 CSP（`script-src 'self'`、`frame-ancestors 'none'` 等）、`X-Content-Type-Options`、`Referrer-Policy` 和 HSTS。
    - 文件頁預設關閉，只在本機開啟。
- [x] **A11 未登入的請求就能消耗大量 CPU 與記憶體。**（#34）（原為高）
  - 證據：
    - 每次檢查密碼，scrypt 約用 32 MiB 記憶體（`auth.py:25`）。
    - 密碼欄位沒有長度上限（`api.py:154`）。
    - 請求內容沒有大小上限。
  - 處理：
    - 密碼加 `max_length`。
    - 驗證密碼的併發數量設上限。
    - 在 proxy 設定請求大小上限，並依 IP 限流。
- [x] **A13 `GET /api/releases` 在讀取時呼叫 GitHub 並寫入資料庫。**（#28）
  - 證據：`release.py:194-225`：每次輪詢都會刷新最近 20 筆 release，在交易中呼叫 GitHub（每次最長 30 秒），並觸發版本清理。
  - 影響：
    - 併發輪詢會占滿資料庫連線池。
    - 找不到 run 的 release 會永遠輪詢下去。
    - 較慢的請求可能用舊資料蓋掉較新的狀態（**推測**）。
  - 處理：
    - 刷新改成背景工作，或改為 `POST`。
    - 呼叫 GitHub 前先結束資料庫交易。
    - 用條件式 `UPDATE` 寫入狀態。
    - 超過一段時間仍找不到 run 就停止。
    - 搭配 G3 的 `run_id`。
- [x] **A14 同步工作卡住 event loop。**（#32）
  - 證據：
    - `api.py:444-448` 的 `async def upload_image` 在 event loop 上執行 Pillow 解碼和 WebP 編碼。
    - `api.py:39-47` 的 async middleware 每次請求都做一次同步的資料庫查詢。
    - 動畫 GIF 的所有影格都放在記憶體裡（`backend/blog/images.py:63-67`）。
  - 處理：
    - `upload_image` 改成一般的 `def`。
    - 限制影格數與總像素數，並調低 `MAX_IMAGE_PIXELS`。
    - 登入檢查改成 dependency，或放到 threadpool 執行。
- [x] **A16 沒有健康檢查、應用程式 log 和稽核紀錄。**（#29）
  - 證據：`api.py` 沒有 `/healthz`；`backend/blog` 沒有用 `logging`。
  - 處理：
    - 加 `GET /healthz`，執行 `SELECT 1`。
    - log 輸出到 stdout，再送進 CloudWatch，並設定 5xx 告警。
    - 登入成功與失敗、發布、永久刪除都寫結構化紀錄。
- [x] **A17 資料庫連線沒有針對 RDS 設定。**（#29）
  - 證據：`backend/blog/db.py` 用 `create_engine(database_url())`，沒有 `pool_pre_ping`，也沒有 TLS 驗證。
  - 處理：
    - 加 `pool_pre_ping=True` 與 `pool_recycle`。
    - 連線字串加 `sslmode=verify-full`。
- [x] **A18 備份與還原腳本不適合雲端。**（#31、#33）
  - 證據：
    - `backup.sh:32` 與 `restore.sh:43-44` 把含密碼的連線字串放在命令列參數。
    - 用本機的 `pg_dump`，版本必須和 RDS 相同。
  - 處理：
    - 密碼改用 `PGPASSWORD` 或 IAM token 傳入。
    - 用和 RDS 同一個大版本的 `postgres` 映像檔執行備份。
- [x] **A19 匯出時要把所有圖片讀進記憶體。**（#32）
  - 證據：
    - `exporter.py:322` 一次載入所有引用到的圖片。
    - `_read_current` 會再把 repo 裡的圖片全部讀一遍。
  - 影響：記憶體用量約是網站圖片總量的 2 倍，小型容器可能被 OOM 終止，release 也會跟著卡住。
  - 處理：
    - 用 hash 比對檔案，不讀出內容。
    - 一次只讀一張圖片。
    - 之後可以考慮把圖片移到 S3。

### 低

- [x] **A15 session 固定 7 天有效，沒有閒置逾時，也無法從介面登出其他裝置。**（#34）（原為中；裝置遺失時，先在 Tailscale 撤銷該裝置）
  - 證據：`auth.py:20` 的 `SESSION_TTL`，`is_signed_in` 不會延長，也不檢查閒置時間。
  - 處理：
    - 加 `last_seen_at`，設定閒置逾時，並縮短絕對有效期限。
    - 加「登出所有裝置」。
- [x] **A20 錯誤訊息可能帶出內部細節。**（#28） `release.py:148` 把 git stderr 原樣存進 `detail` 並回傳。remote URL 含 token 時可能外洩。處理：先去掉 URL 裡的帳號密碼再存。
- [x] **A21 CMS 的 API 路徑寫成絕對路徑。**（#29） `cms/src/api.ts:426` 的 `/api`，以及預覽和封面的圖片網址。CMS 必須放在網域根目錄。處理：從 `import.meta.env.BASE_URL` 推導路徑，或規定 CMS 使用獨立的網域。
- [x] **A22 沒有限流。**（#34：「更新網站」加冷卻時間；依 IP 限流在 proxy 設定） 除了登入以外，所有端點都沒有限流，包括「更新網站」。處理：在 proxy 或 WAF 依 IP 限流，「更新網站」加冷卻時間。

## 三、自訂網域與 CDN 的準備

公開網站留在 GitHub Pages，前面加自訂網域與 CDN 時需要處理。

- [ ] **D2 GitHub Pages 前面加 CDN 時的憑證設計。**
  - DNS 指向 CDN 時，Pages 無法自行申請憑證。二選一：
    - 先讓 Pages 用自訂網域取得憑證，再把 CDN 放到前面。
    - CDN 直接以 `hack-ray.github.io/personal-blog` 為來源，並設定 `BASE_PATH=""`。缺點是舊網址會繼續存在，形成重複內容；canonical 可以緩解。
  - 兩種做法都要在 GitHub 驗證網域，防止子網域被搶用（**推測**）。
- [ ] **D3 CDN 快取規則與部署後清除快取。**
  - 有 hash 的檔案可以長期快取：`_next/static/*`、`images/*`、`thumbs/*`。
  - HTML、`feed.xml`、`sitemap.xml`、`search-index.json` 要設短的 TTL，或在部署後清除快取。
  - 目前 release 以 Pages 部署成功判定為 `deployed`，不代表 CDN 已經更新。
- [ ] **D4 沒有 `robots.txt`。** 換成自訂網域後才有意義。處理：加 `frontend/src/app/robots.ts`，指向 sitemap。
- [ ] **D5 RSS 的 GUID 是文章網址。**
  - 證據：`frontend/src/content/feed.ts:20`。
  - 影響：換網域後，訂閱者的閱讀器會把每篇文章當成新文章再顯示一次。
  - 處理：換網域之前，或和換網域同時，改用以 docId 為基礎、`isPermaLink="false"` 的 GUID。
- [ ] **D6 文章裡寫死的舊網址會變成外部連結。** `markdown.ts:33` 只把開頭是目前 `SITE_ORIGIN` 的連結視為站內連結。處理：換網域前，搜尋內容 repo 裡的舊網址並改成相對路徑。
- [ ] **D7 公開網站的 CSP。** 在 CDN 加安全標頭時，要考慮三件事：內嵌的 `THEME_SCRIPT`（`frontend/src/app/layout.tsx:26`）需要 hash、giscus 需要 `frame-src https://giscus.app`、Next 本身會輸出內嵌 script。

## 已完成

- [x] **Topic 不合法時，修改沒有儲存，狀態卻顯示「已儲存」。** 狀態由 `cms/src/editor-status.ts` 決定，顯示「未儲存：Topic 不合法」。存檔的缺口另見 G2。
- [x] **前後端判斷「文章引用了哪些圖片」的規則不一致。** 兩邊都改用 Markdown parser，並共用 `frontend/test-fixtures/image-refs.json`（BE-007）。
- [x] **`GET /api/releases` 只在最近 30 個 workflow run 中找對應的 run。** 改為只列出 release 建立前 5 分鐘之後的 run，並逐頁查找（BE-010）。重試的問題另見 G3。
- [x] **部署前少了兩項檢查。** `deploy.yml` 在 build 前執行 typecheck，CI 執行 `verify-site.sh`。
- [x] **永久刪除是否改寫內容 repo 歷史。** 不改寫，見 Addendum 02 PUB-007。
- [x] **D1 部署流程沒有設定 `BASE_PATH` 與 `SITE_ORIGIN`，檢查腳本也寫死 `/personal-blog`。** `deploy.yml` 改由 `actions/configure-pages` 取得兩者，自訂網域也適用；CI 與檢查腳本固定用測試值建置，不受部署設定影響（#22）。
- [x] **`docs/local-setup.md` 寫 migration 到 `0006`。** 改成「到最新的 migration」（#22）。
