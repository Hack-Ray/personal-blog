"use client";

import { startSearch, type SearchSnapshot } from "./load-index.ts";

export function SearchStatus({ snapshot, count }: { snapshot: SearchSnapshot; count?: number }) {
  const failed = snapshot.phase === "metadata-error" || snapshot.phase === "body-error";
  let message: string;
  if (snapshot.phase === "idle" || snapshot.phase === "metadata-loading") {
    message = "正在載入搜尋資料…";
  } else if (snapshot.phase === "metadata-error") {
    message = "無法載入搜尋資料。請重試；若持續失敗，請重新載入頁面。";
  } else if (snapshot.phase === "complete") {
    message = count === undefined ? "" : `${count} 篇符合`;
  } else {
    const progress = `已搜尋 ${snapshot.loadedYears}/${snapshot.totalYears} 年全文`;
    const matches = count === undefined ? "" : `目前 ${count} 篇符合 · `;
    message = snapshot.phase === "body-error"
      ? `${matches}${progress}。${snapshot.failedYear} 年資料載入失敗，結果尚未完整。請重試；若持續失敗，請重新載入頁面。`
      : `${matches}${progress}，正在搜尋較舊文章…`;
  }
  return (
    <div className="search-status">
      <p className="meta" role="status" data-search-phase={snapshot.phase}>{message}</p>
      {failed && (
        <div>
          <button type="button" onClick={() => { void startSearch(); }}>重試搜尋</button>{" "}
          <button type="button" onClick={() => window.location.reload()}>重新載入頁面</button>
        </div>
      )}
    </div>
  );
}
