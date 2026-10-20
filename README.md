# Personal Blog

個人部落格與作品集。寫作在本機的 CMS 進行，公開網站是靜態網站，部署在 GitHub Pages：<https://hack-ray.github.io/personal-blog/>。

## 架構

| 目錄 | 內容 | 技術 |
| --- | --- | --- |
| `backend/` | 本機 CMS API。保存草稿、已發布版本、圖片與登入資料，並負責「更新網站」。 | Python、FastAPI、PostgreSQL 16、SQLAlchemy、Alembic、uv |
| `cms/` | CMS 介面，由後端在 `/admin/` 提供。 | Vite、React、TypeScript |
| `frontend/` | 公開網站，從內容 Snapshot 產生靜態頁面。 | Next.js（`output: "export"`）、TypeScript |
| `docs/` | 系統規格（Baseline 與 Addendum 01–04）、本機安裝步驟、設定清單。 | |

網站內容不在這個 repo，而在 private repo `Hack-Ray/personal-blog-content`。發布流程：

1. 在 CMS 按「發布」：在資料庫建立一個新的 Published Version。這一步不會改變網站。
2. 在「網站發布」頁按「更新網站」：後端把所有已發布文章匯出成 Snapshot（`manifest.json`、`articles/`、`images/`），commit 並 push 到內容 repo，再啟動 `Deploy site` workflow。
3. `.github/workflows/deploy.yml` 以這份 Snapshot 建置 `frontend/`，部署到 GitHub Pages。

後端與前端之間只透過 Snapshot 溝通，格式以 `frontend/src/content/parse.ts` 為準；後端測試會用它驗證匯出結果。

## 開始

- 本機安裝與日常使用：[`docs/local-setup.md`](docs/local-setup.md)
- 後端：[`backend/README.md`](backend/README.md)
- 公開網站：[`frontend/README.md`](frontend/README.md)
- CMS 介面：[`cms/README.md`](cms/README.md)
- 尚未完成的設定：[`docs/setup-todo.md`](docs/setup-todo.md)

## 測試

CI（`.github/workflows/ci.yml`）在每次 push 與 pull request 執行以下三組測試：

```sh
# backend：需要 PostgreSQL 與 Node 22（契約測試會執行前端的 Snapshot parser）
cd backend && TEST_DATABASE_URL=postgresql+psycopg://blog:blog@127.0.0.1:5432/blog_test uv run pytest

# cms
cd cms && npm ci && npm test && npm run build

# frontend：以 frontend/sample-site-data 的範例內容建置
cd frontend && npm ci && npm test && npm run typecheck && npm run build
```
