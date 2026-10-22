# 本機與雲端共用 CMS 的驗證紀錄

日期為 2026-10-22。程式分支為 `feature/portable-cms`。這份紀錄區分程式已實作與外部環境已啟用。

## 已執行

| 範圍 | 結果 | 可重跑的檢查 |
| --- | --- | --- |
| 公開網站 | 122 項單元測試通過，TypeScript 通過 | `cd frontend && npm test && npm run typecheck` |
| 網域與路徑 | 根路徑與 `/personal-blog` 都成功建置；420 個連結無錯誤；網站檢查全部通過 | `frontend/scripts/check-links.ts`、`frontend/scripts/verify-site.sh` |
| CMS 介面 | 62 項單元測試通過，Vite 建置通過 | `cd cms && npm test && npm run build` |
| 後端設定、認證、內容 repo、分支傳遞 | 66 項針對性測試通過 | `tests/test_config.py`、`tests/test_github.py`、`tests/test_content_repository.py`、`test_api_dispatch_includes_nondefault_content_branch` |
| 背景工作 | 6 項佇列行為測試通過；另有 1 項從真實資料庫 Snapshot 到本機 Git commit 與部署提交的端到端測試通過 | `tests/test_release_jobs.py`，此環境排除 `test_duplicate_job_submissions_are_refused` |
| 雲端腳本 | 7 項成功順序與故障情境測試通過 | `cd backend && python scripts/test-cloud-deploy.py` |
| 靜態檢查 | Ruff、workflow YAML、各 shell 區塊語法與 diff whitespace 通過 | `uv run --project backend ruff check backend/blog backend/tests backend/migrations` |

後端在這個環境使用 PGlite 的 PostgreSQL WASM 引擎與 socket adapter。測試執行了 migration、認證 API、實際資料匯出，以及以本機 bare Git 為基礎的 Git Data API 測試替身。沒有寫入正式 GitHub repo。

PGlite 會共用底層連線，不能代表原生 PostgreSQL 的多連線、鎖與隔離行為。完整後端測試曾因這個限制停在 advisory lock；這不計為通過。測試替身也不能代替 GitHub 真正的權限設定與服務行為。

## 尚待驗證

- 在 `.github/workflows/ci.yml` 的原生 PostgreSQL 16 執行完整後端測試，包含單一發布鎖、重複入列拒絕與目的地變更的重試測試。
- 在 `.github/workflows/cms-image.yml` 建置並執行 Docker image，實測 migration、備份、還原與健康檢查。此環境沒有 Docker engine。
- 用瀏覽器驗證新的 CMS 發布互動，以及 CDN 啟用後的 CSP、giscus、主題與搜尋。此環境 Chromium 下載回傳截斷檔案，沒有取得瀏覽器驗證結果。
- 作者設定 GitHub App、Tailscale、主機、備份目標與 DNS 後，才進行正式端到端啟用。雲端 workflow 預設停用。
- CDN 的 provider、清除快取 API 與 404 安全標頭仍由實際供應商整合。`cdn-headers.json` 是可套用的輸入資料，GitHub Pages 不會自行執行它。

後端與部署流程各有獨立程式審查。審查找出的非預設內容分支與重試部署目的地問題已修正，複查沒有剩餘 P1 或 P2。審查通過不等同上面未執行的 runtime 檢查通過。
