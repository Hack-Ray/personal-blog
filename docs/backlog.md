# 待辦事項

這份清單記錄已知但還沒修的問題。完成一項就勾選，並寫上處理它的規格編號或 commit。新發現的問題加在最後。

## CMS

- [x] **Topic 不合法時，修改沒有儲存，狀態卻顯示「已儲存」。**
  `cms/src/editor.tsx` 只在 Topic 的 slug 與名稱都合法時才呼叫 `DraftSync.edit`。不合法時修改只留在畫面上，狀態停在「已儲存」，關掉分頁就會遺失。
  處理：狀態改為顯示「未儲存」並說明原因；Topic 修正後自動儲存。
  已修正：狀態由 `cms/src/editor-status.ts` 決定，顯示「未儲存：Topic 不合法」；修正 Topic 的那次輸入就會連同先前的修改一起儲存。

## 圖片

- [x] **前後端判斷「文章引用了哪些圖片」的規則不一致。**
  後端 `backend/blog/images.py` 與前端 `frontend/src/content/parse.ts` 各用一個 regex 掃 Markdown，規則不同：
  - 帶 title 的圖片 `![](images/<id> "說明")`：後端不算引用，所以不匯出也可能被 GC 刪除；前端算引用，因此 build 失敗。
  - code block 裡的範例文字 `](images/...)`：兩邊都算引用。對不到圖片時，匯出或 build 會失敗。
  處理：兩邊都改用 Markdown parser 找出圖片 token，並以一份共用的測試資料驗證兩邊結果相同。
  已修正：後端 `images.refs()` 用 markdown-it-py、前端 `imageRefs()` 用 marked，兩邊都只算 href 以 `images/` 開頭的圖片 token；`frontend/test-fixtures/image-refs.json` 由兩邊的測試共用（BE-007）。

## 網站發布

- [ ] **`GET /api/releases` 只在最近 30 個 workflow run 中找對應的 run。**
  `backend/blog/release.py` 的 `GitHubActions.find_run` 用 `per_page=30` 列出 run。run 一多就找不到，release 會一直停在 `dispatched`。
  處理：只查詢 release 建立之後的 run（GitHub API 的 `created` 篩選）。

## CI 與部署

- [ ] **部署前少了兩項檢查。**
  `.github/workflows/deploy.yml` 沒有執行 `npm run typecheck`。`frontend/scripts/verify-site.sh` 只能手動執行，不在 CI 中。
  處理：`deploy.yml` 加上 typecheck；CI 的 frontend job 以範例資料建置後，啟動本機伺服器並執行 `verify-site.sh`。

## 規格

- [x] **永久刪除是否改寫內容 repo 歷史。** 不改寫，見 Addendum 02 PUB-007。
