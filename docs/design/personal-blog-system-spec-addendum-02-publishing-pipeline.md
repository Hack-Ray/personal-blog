# Personal Blog — Addendum 02：Publishing Pipeline（Snapshot-based Build）

> **這是設計紀錄，不是教學。** 記錄需求與架構決策及其理由；實際行為以程式碼為準。要建立自己的部落格請看 [`fork-and-deploy.md`](../fork-and-deploy.md)。

> **基線**：[Baseline v1.0](./personal-blog-system-spec-baseline-v1.0.md)，[Addendum 01](./personal-blog-system-spec-addendum-01-domain-model.md)
> **日期**：2026-10-20 起
> **來源**：Architecture Change Proposal B-01
> **範圍**：從 CMS 到 GitHub Pages 的發布流程；CMS、Article Lifecycle 與 Domain Model（ART-020／ART-021）不在此範圍。

## Confirmed Decisions

### PUB-001：GitHub Actions 只讀取 Content Snapshot，不連 CMS

- **Date**：2026-10-20
- **Status**：Confirmed
- **Context**：Baseline 1.2 要求低成本、減少常駐後端，公開閱讀不依賴後端。
- **Decision**：
  - 發布流程：Publish（持久化 Published Version）→ 「更新網站」由 Content Exporter 產生完整 Snapshot → 以單一 commit 寫進內容 repo → GitHub Actions 驗證並執行 Next.js Static Export → 部署至 GitHub Pages。
  - GitHub Actions 不存取 FastAPI 或 PostgreSQL。
  - 發布流程不使用 Redis、Message Queue 或獨立微服務；背景工作存在 PostgreSQL（BE-022）。
  - CMS 與 PostgreSQL 放在哪裡由部署者決定：作者的 CMS 在 AWS EC2（BE-027），fork 預設在自己的電腦，也可以放在 Tailscale 主機（BE-020）。
- **Consequences**：
  - CMS 停機時無法發布；已部署網站不受影響（符合 Baseline 1.2）。
  - Exporter 與 Snapshot 格式是 CMS 與公開網站之間唯一的介面；CMS 換位置時 Actions／Pages 不需修改。
  - 設定一律經由環境變數，由 `backend/blog/config.py` 啟動時讀取（BE-021）。本機 PostgreSQL 以 Docker Compose 執行，CMS 只綁定 `127.0.0.1`。

### PUB-002：Content Snapshot 存放於獨立的 private 內容 repo

- **Date**：2026-10-20
- **Status**：Confirmed
- **Context**：Snapshot 若 commit 至公開 repo，封存與永久刪除的內容會永久留在公開 Git 歷史，與 Baseline 7.2、7.3 衝突。
- **Decision**：
  - Snapshot 存放於 private 內容 repo，預設名稱是 `<程式 repo>-content`，可由 Actions variable `CONTENT_REPO` 指定。程式碼 repo 維持公開，GitHub Pages 由程式碼 repo 的 Actions 部署。
  - `deploy.yml` 以唯讀權限讀內容 repo：設定 GitHub App（`APP_CLIENT_ID`、`APP_PRIVATE_KEY`）時用 App 換得的 token，否則用 personal token `CONTENT_REPO_TOKEN`。作者用 App，PAT 是 fork 的預設。
  - 內容 repo 的 commit 歷史即為已發布 Snapshot 的版本紀錄；重試與回滾以重新建置指定 commit 完成。
- **Consequences**：
  - 已部署網站上曾公開的內容仍可能被第三方保存；此為公開網站固有限制，不由本決策處理。
  - 永久刪除不改寫內容 repo 的歷史（PUB-007）。

### PUB-003：Snapshot 格式與一致性

- **Date**：2026-10-20
- **Status**：Confirmed
- **Decision**：
  - 內容 repo 根目錄結構：

    ```text
    manifest.json
    profile.json
    articles/{docId}.json
    images/{contentHash}.{ext}
    ```

    `profile.json` 是網站與關於頁的內容（BE-017）。

  - `manifest.json` 包含：`schema_version`、`release_id`（ULID）、`created_at`、`articles`（每篇的 `docId`、Published Version，以及可省略的 `slug`、`redirect_from`）、`archived_articles`。欄位以前端 `frontend/src/content/parse.ts` 為準（BE-004）。
  - 只匯出公開網站需要的資料；不匯出 Working Draft、Draft Snapshots、Pending Deletion 文章、管理員資訊或其他私有資料。
  - Exporter 在單一資料庫交易（REPEATABLE READ）中讀取，確保整份 Snapshot 對應同一時點的發布狀態。
  - 寫入失敗時不 push、不更新遠端分支。git 模式在每次匯出前把 Snapshot 路徑重設回 HEAD（BE-016）；API 模式先建好 tree 與 commit，最後才更新分支（BE-022）。
  - 圖片檔名使用內容雜湊；相同內容永遠同名，換圖即為新檔名，不原地覆寫（Baseline 8.1）。
  - 每次 Snapshot 都是完整全量輸出（與 Baseline 2.2 的 Full Build 一致）。Exporter 把文章引用的圖片寫進 Snapshot，Actions 不從其他地方取圖。

### PUB-004：建置驗證與部署序列化

- **Date**：2026-10-20
- **Status**：Confirmed（CI 的範圍與觸發條件為使用者 2026-10-21 至 10-23 指定）
- **Decision**：
  - 「更新網站」以 `workflow_dispatch` 啟動程式碼 repo 的 `deploy.yml`，帶入內容 repo 的 commit SHA（BE-010）。程式碼 push 到 `main` 也觸發 `deploy.yml`，使用內容 repo 的 HEAD。
  - CI：push 到 `main` 時由 `deploy.yml` 以 `workflow_call` 呼叫 `ci.yml`，`ci.yml` 自己只有 `pull_request`、`workflow_call` 與手動觸發。內容發布（`workflow_dispatch`）略過 CI，因為它不改程式碼，而該版程式碼在 push 時已通過 CI。`build` 與 CI 並行；`deploy` 等 `build` 成功，且 CI 成功或被略過。
  - 程式碼 push 到 `main` 時，只有改到網站的建置來源（`frontend/`、`.nvmrc`、`deploy.yml`）才 build 與部署；只改文件、後端或 CMS 的 push 只跑 CI。內容發布與重試一律 build。
  - Build 時驗證 Snapshot：`schema_version` 可識別、manifest 列出的每篇文章檔案存在、文章引用的每張圖片存在。之後以 `check-links.ts` 檢查站內連結（PUB-008）。任一項失敗即不部署，舊網站維持上線。
  - 部署以 job 層級的 `concurrency` 序列化：build 用 `pages-build`、deploy 用 `pages-deploy`，`cancel-in-progress: false`。設在 job 而不是整個 run，所以不 build 的 push run 不會取消排隊中的內容發布。
  - 部署前檢查兩件事，任一不成立就略過部署，由較新的建置接手：本次建置的內容 commit 仍是內容 repo 的 HEAD；`main` 的 `frontend/`、`.nvmrc`、`deploy.yml` 與本次建置相同。查詢失敗時 run 失敗，不當成「有更新的內容」略過。
  - 部署後確認線上網站已是這次的 build（PUB-010）。
- **Consequences**：Baseline 9.2 的 Latest State Wins 由內容 repo 的 commit 順序與部署前的 HEAD 檢查達成，不另設鎖或序列號。

### PUB-005：定期工作與失敗通知

- **Date**：2026-10-20
- **Status**：Confirmed
- **Decision**：
  - 30 天到期永久刪除、舊 Published Version 清理與圖片 GC 都由 `python -m blog.maintenance` 執行。工作可重複執行並收斂到相同結果，以 advisory lock 避免同時執行。Baseline 8.3 與 7.3 的保留規則不變。
  - 本機 CMS 只在寫作時啟動，所以由 `start.sh` 在啟動時執行一次（使用者 2026-10-20 確認）。長時間不啟動 CMS 時，到期的工作延到下次啟動；這只延後刪除，不影響已部署的網站。
  - 雲端 CMS 常駐，由主機 cron 每小時執行（`cloud-maintenance.sh`）。
  - 建置／部署失敗通知使用 GitHub 內建的 workflow 失敗 Email 通知。
  - 舊 Published Version 與圖片的清理，仍須等新網站部署成功後才可執行（Baseline 6.3、8.3）；CMS 以 GitHub API 查詢部署結果（BE-010）。

### PUB-006：備份責任

- **Date**：2026-10-20
- **Status**：Confirmed
- **Decision**：內容 repo 只保存已發布 Snapshot，不能取代 CMS 備份。CMS 的 PostgreSQL（含草稿、版本、圖片）另行備份（BE-012、BE-025）。

### PUB-007：永久刪除不改寫內容 repo 歷史

- **Date**：2026-10-20
- **Status**：Accepted (delegated)
- **Context**：文章被永久刪除後，下一次「更新網站」的 Snapshot 不再包含它，網站回 404。但內容 repo 的舊 commit 仍保有它的 JSON 與圖片。
- **Decision**：不改寫內容 repo 的歷史。永久刪除只影響之後的 Snapshot。
- **理由**：
  - 內容 repo 是 private，舊 commit 裡只有曾經公開過的內容，沒有草稿或私人資料（PUB-003）。
  - 改寫歷史需要 force-push。`releases.content_commit` 記錄的 commit 會消失，部署 workflow 以 commit 判斷是否過期的機制（PUB-004）也會失準。
  - 其他人或其他電腦上的 clone 在 force-push 後必須重新 clone。
- **Consequences**：若有內容因法律或隱私原因必須從歷史中移除，需要手動改寫內容 repo 的歷史，並同步處理 clone 與 `releases` 紀錄。CMS 不提供這個流程。

### PUB-008：連結檢查、瀏覽器測試與 token 到期提醒

- **Date**：2026-10-21
- **Status**：Confirmed（使用者 2026-10-21 指定）
- **Decision**：
  - 連結檢查：`frontend/scripts/check-links.ts` 檢查 build 出來每個頁面的站內 `href`／`src` 都對應到 `out/` 中的檔案；不在 basePath 下的絕對路徑也算失效。外部網站不檢查。CI 對範例資料執行；`deploy.yml` 對真實內容執行，失敗就不部署，和缺圖相同（PUB-004）。
  - 瀏覽器測試：`frontend/e2e/` 以 Playwright（Chromium）測試搜尋下拉、深淺色切換、程式碼複製、圖片放大、回到頂端、歸檔排序、404 與手機寬度，CI 在範例資料的 build 上執行。
  - Token 到期只適用於 personal token：
    - `token-expiry.yml` 每週一以 `CONTENT_REPO_TOKEN` 呼叫 GitHub API，讀回應標頭 `github-authentication-token-expiration`；剩 30 天以內或已無法讀取內容 repo 時，在本 repo 開一個 issue（已有未關閉的同類 issue 時不重複開）。設定 GitHub App（`APP_CLIENT_ID`）時整個 job 略過。
    - CMS 的 `CMS_GITHUB_TOKEN` 不在 Actions 中，由 CMS 的「網站發布」頁透過 `GET /api/github-token` 以同樣方式讀到期日，30 天內顯示提醒。
- **Consequences**：token 換新後兩邊都會自動讀到新的到期日，不需要改設定。GitHub App 的 token 是短效的，每次自動重新取得，不需要提醒。

### PUB-009：部署久候時提示 GitHub 事故

- **Date**：2026-10-22
- **Status**：Confirmed（使用者 2026-10-22 指定）
- **Decision**：
  - 「網站發布」頁上，有 release 處於「等待建置」或「建置中」，且距最近一次啟動部署（`dispatched_at`，重試會重設）已滿 10 分鐘時，顯示提示。平常的部署約 1.5～4 分鐘完成。
  - 提示的內容來自 `GET /api/github-status`：CMS 後端讀 githubstatus.com 的 `/api/v2/incidents/unresolved.json`，只保留影響 Actions 或 Pages 的事故，回傳名稱與 `https://` 連結。管理頁的 CSP 是 `connect-src 'self'`，所以由後端代查，不放寬 CSP。
  - 有事故時列出事故名稱與連結；沒有事故或查詢失敗時，提示可能是 GitHub Actions 延遲，並連到 GitHub Status。
- **Consequences**：GitHub 端的延遲不必再靠作者自己去查；提示只是說明，不會自動重試或取消部署。

### PUB-010：還原備份後以資料庫為準；部署後確認線上網站

- **Date**：2026-10-27
- **Status**：Confirmed（使用者 2026-10-27 指定）
- **Decision**：
  - 還原較舊的備份後，資料庫是內容的唯一來源。下一次「更新網站」把內容 repo 改成資料庫的內容，網站回到備份當時的狀態，不另外詢問。git 模式本來就這樣運作；API 模式由還原腳本最後執行的 `python -m blog.content_repository after-restore` 把遠端 HEAD 記成最新 release，讓下一次發布以它為 parent。這個命令不寫入 GitHub。
  - 還原腳本（本機 `restore.sh`、雲端 `cloud-restore.sh`）先停 CMS 並備份目前資料，還原在單一交易內完成，還原後登出所有 session。
  - 內容回滾不另做按鈕：在 CMS 把有問題的文章封存或改回，再「更新網站」。程式回滾用 revert PR。
  - `deploy.yml` 的部署後步驟以首頁回應中的 Next build id 確認線上網站已是這次的 build，10 分鐘內看不到就讓 run 失敗。
  - 最新一次 release 被記為 superseded（run 被之後的程式碼 push 取代）時可以重試。
- **Consequences**：還原舊備份後，備份之後才發布的文章會在下一次「更新網站」時從網站消失；要保留它們，應還原較新的備份。網站壞掉而 GitHub 沒有通知的情況縮小到部署之後才發生的故障，這部分由外部監控負責。
