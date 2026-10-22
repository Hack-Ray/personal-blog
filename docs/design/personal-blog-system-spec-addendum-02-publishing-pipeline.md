# Personal Blog — Addendum 02：Publishing Pipeline（Snapshot-based Build）

> **這是設計紀錄，不是教學。** 記錄開發時的需求與架構決策及其理由；實際行為以程式碼為準。要建立自己的部落格請看 [`fork-and-deploy.md`](../fork-and-deploy.md)。

> **基線**：[Baseline v1.0](./personal-blog-system-spec-baseline-v1.0.md)（截至 2026-10-11），[Addendum 01](./personal-blog-system-spec-addendum-01-domain-model.md)
> **日期**：2026-10-20
> **來源**：Architecture Change Proposal B-01
> **設計原則**：只改變 Publishing Pipeline；CMS、Article Lifecycle 與 Domain Model（含 ART-020／ART-021）不變。

## Confirmed Decisions

### PUB-001：CMS 與 PostgreSQL 先在本機執行，GitHub Actions 只讀取 Content Snapshot

- **Date**：2026-10-20
- **Status**：Confirmed
- **Context**：Baseline 2.1 未決定 GitHub Actions 如何安全存取後端；1.2 要求低成本、減少常駐後端。
- **Decision**：
  - V1 的 FastAPI CMS 與 PostgreSQL 在作者本機執行；之後可能遷移至 AWS。
  - 發布流程：Publish（持久化 Published Version）→ Content Exporter 產生完整 Snapshot → 以單一 commit push → GitHub Actions 驗證並執行 Next.js Static Export → 部署至 GitHub Pages。
  - GitHub Actions 不存取 FastAPI 或 PostgreSQL。
  - V1 不使用 Redis、Message Queue、Object Storage、雲端 Scheduler 或獨立微服務。
- **Consequences**：
  - 作者電腦關機時無法發布；已部署網站不受影響（符合 Baseline 1.2）。
  - Exporter 與 Snapshot 格式成為 CMS 與公開網站之間唯一的介面；CMS 遷移至 AWS 時 Actions／Pages 不需修改。
  - 設定一律經由環境變數（例如 `DATABASE_URL`、匯出目錄、內容 repo 位置）；本機 PostgreSQL 以 Docker Compose 執行。
  - CMS 僅在本機時仍須有管理員身分驗證（Baseline 5.1、第 10 節第 7 條不變）；可先只綁定 `127.0.0.1`。
- **Supersedes**：Baseline 2.1 架構圖中「GitHub Actions 讀取發布資料」的取得方式；Baseline 12 中「後端部署平台」於 V1 定為本機。

### PUB-002：Content Snapshot 存放於獨立的 private 內容 repo

- **Date**：2026-10-20
- **Status**：Confirmed
- **Context**：Snapshot 若 commit 至公開 repo，封存與永久刪除的內容會永久留在公開 Git 歷史，與 Baseline 7.2、7.3 衝突。
- **Decision**：
  - Snapshot 存放於 private repo（暫名 `personal-blog-content`）；程式碼 repo `personal-blog` 維持公開，GitHub Pages 由程式碼 repo 的 Actions 部署。
  - 程式碼 repo 的 Actions 以唯讀 token checkout 內容 repo。
  - 內容 repo 的 commit 歷史即為已發布 Snapshot 的版本紀錄；重試與回滾以重新建置指定 commit 完成。
- **Consequences**：
  - 已部署網站上曾公開的內容仍可能被第三方保存；此為公開網站固有限制，不由本決策處理。
  - 永久刪除如需自內容 repo 歷史移除，需改寫該 private repo 歷史；具體政策列為 Open Question。
- **Supersedes**：無。

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

    （`profile.json` 由 Addendum 03 BE-017 加入，是關於頁的內容。）

  - `manifest.json` 至少包含：`schema_version`、`release_id`、`created_at`、`articles`（每篇的 `docId` 與 Published Version）、`archived_articles`。
  - 只匯出公開網站需要的資料；不匯出 Working Draft、Draft Snapshots、Pending Deletion 文章、管理員資訊或其他私有資料。
  - Exporter 在單一資料庫交易（REPEATABLE READ 或更高）中讀取，確保整份 Snapshot 對應同一時點的發布狀態。
  - Exporter 先寫入暫存目錄，全部成功後才整份取代工作目錄內容並建立一個 commit；任何步驟失敗即不 push。（實作改為每次匯出前把 Snapshot 路徑重設回 HEAD，見 Addendum 03 BE-016。）
  - 圖片檔名使用內容雜湊；相同內容永遠同名，換圖即為新檔名，不原地覆寫（Baseline 8.1）。
  - 每次 Snapshot 都是完整全量輸出（與 Baseline 2.2 的 Full Build 一致）。
- **Supersedes**：Baseline 8.2「GitHub Actions 依文章引用關係取得該版本圖片」改為由 Exporter 匯出圖片至 Snapshot。

### PUB-004：建置驗證與部署序列化

- **Date**：2026-10-20
- **Status**：Confirmed
- **Decision**：
  - Exporter push 後，由 CMS 觸發程式碼 repo 的 workflow，並帶入內容 repo 的 commit SHA。程式碼 repo 的 push 亦觸發建置，使用內容 repo 的 HEAD。
  - Build 前先執行完整的 CI（`deploy.yml` 以 `workflow_call` 呼叫 `ci.yml`）。CI 失敗即不建置、不部署（2026-10-21 使用者指定）。
  - Build 前驗證 Snapshot：`schema_version` 可識別、manifest 列出的每篇文章檔案存在、文章引用的每張圖片存在。驗證失敗即不部署，舊網站維持上線。
  - 部署以 workflow `concurrency` 序列化。
  - 部署前檢查：本次建置的內容 commit 若已不是內容 repo 的 HEAD，則略過部署（較新的建置會接手）。
- **Supersedes**：Baseline 9.2 中尚待設計的「原子性／鎖／序列號協定」，以內容 repo 的 commit 順序與 HEAD 檢查取代。

### PUB-005：本機環境下的定時工作與失敗通知

- **Date**：2026-10-20
- **Status**：Confirmed
- **Decision**：
  - 每週圖片 GC 與 30 天到期永久刪除，改為「CMS 啟動時補跑已到期工作」；工作必須可重複執行並收斂到相同結果。Baseline 8.3 與 7.3 的保留規則不變。
  - 本機版的 CMS 只在寫作時啟動，不常駐，所以不在執行中定期排程（使用者 2026-10-20 確認）。
  - 2026-10-22 更新：工作移到 `python -m blog.maintenance`。本機由 `start.sh` 在啟動時執行，雲端用排程執行（backlog A7）。長時間不啟動 CMS 時，到期的工作延到下次啟動才執行；這只延後刪除，不影響已部署的網站。
  - V1 的建置／部署失敗通知使用 GitHub 內建的 workflow 失敗 Email 通知。
  - 舊 Published Version 與圖片的清理，仍須等新網站部署成功後才可執行（Baseline 6.3、8.3 不變）；CMS 以 GitHub API 查詢部署結果。
- **Supersedes**：Baseline 9.3「持續失敗需以 Email 通知管理員」的實作方式於 V1 定為 GitHub 內建通知；8.3「每週五一次」改為到期補跑，寬限期規則不變。

### PUB-006：備份責任

- **Date**：2026-10-20
- **Status**：Confirmed
- **Decision**：內容 repo 只保存已發布 Snapshot，不能取代 CMS 備份。本機 PostgreSQL（含草稿、版本、圖片）需另行備份。
- **Supersedes**：無。

### PUB-007：永久刪除不改寫內容 repo 歷史

- **Date**：2026-10-20
- **Status**：Accepted (delegated)
- **Context**：文章被永久刪除後，下一次「更新網站」的 Snapshot 不再包含它，網站回 404。但內容 repo 的舊 commit 仍保有它的 JSON 與圖片。
- **Decision**：V1 不改寫內容 repo 的歷史。永久刪除只影響之後的 Snapshot。
- **理由**：
  - 內容 repo 是 private，舊 commit 裡只有曾經公開過的內容，沒有草稿或私人資料（PUB-003）。
  - 改寫歷史需要 force-push。`releases.content_commit` 記錄的 commit 會消失，部署 workflow 以 commit 判斷是否過期的機制（PUB-004）也會失準。
  - 其他人或其他電腦上的 clone 在 force-push 後必須重新 clone。
- **Consequences**：若有內容因法律或隱私原因必須從歷史中移除，需要手動改寫內容 repo 的歷史，並同步處理本機 clone 與 `releases` 紀錄。V1 不提供這個流程。
- **Supersedes**：無；回答本文件的 Open Question「永久刪除是否需要改寫內容 repo 歷史」。

### PUB-008：連結檢查、瀏覽器測試與 token 到期提醒

- **Date**：2026-10-21
- **Status**：Confirmed（使用者 2026-10-21 指定）
- **Decision**：
  - 連結檢查：`frontend/scripts/check-links.ts` 檢查 build 出來每個頁面的站內 `href`／`src` 都對應到 `out/` 中的檔案；不在 basePath 下的絕對路徑也算失效。外部網站不檢查。CI 對範例資料執行；`deploy.yml` 對真實內容執行，失敗就不部署，和缺圖相同（PUB-003）。
  - 瀏覽器測試：`frontend/e2e/` 以 Playwright（Chromium）測試搜尋下拉、深淺色切換、程式碼複製、圖片放大、回到頂端、歸檔排序、404 與手機寬度，CI 在範例資料的 build 上執行。
  - Token 到期：`token-expiry.yml` 每週一以 `CONTENT_REPO_TOKEN` 呼叫 GitHub API，讀回應標頭 `github-authentication-token-expiration`；剩 30 天以內或已無法讀取內容 repo 時，在本 repo 開一個 issue（已有未關閉的同類 issue 時不重複開）。CMS 的 `GITHUB_TOKEN` 不在 Actions 中，改由 CMS 的「網站發布」頁透過 `GET /api/github-token` 以同樣方式讀到期日，30 天內顯示提醒。
- **Consequences**：token 換新後兩邊都會自動讀到新的到期日，不需要改設定。

## Open Questions（尚未確認）

- ~~本機 PostgreSQL 的備份方式、頻率與存放位置。~~ 已由 Addendum 03 BE-012 決定。
- ~~永久刪除是否需要改寫內容 repo 歷史，以及何時執行。~~ 不改寫，見 PUB-007。
- ~~`release_id` 的格式（例如 ULID）與 manifest 的完整 JSON Schema。~~ `release_id` 為 ULID；manifest 與文章 JSON 的欄位以前端 `frontend/src/content/parse.ts` 為準（Addendum 03 BE-004）。
- ~~文章 JSON 的欄位定義；目前前端 fixture（`frontend/content/site.json`）需改為讀取此格式。~~ 前端已改為讀取 Snapshot（`frontend/sample-site-data/`）。
- ~~CMS 觸發 workflow 的方式（`repository_dispatch` 或 `workflow_dispatch`）與部署結果查詢的實作。~~ 使用 `workflow_dispatch`，見 Addendum 03 BE-010。
- 遷移至 AWS 的條件與時機。
