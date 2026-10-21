import Link from "next/link";
import { BASE_PATH } from "../site.ts";
import { LatestPosts } from "./latest-posts.tsx";

export default function NotFound() {
  return (
    <>
      <h1>找不到頁面</h1>
      <p>這個網址沒有內容，可能已經移動或刪除。試試搜尋，或看看最新文章。</p>
      <form role="search" method="get" action={`${BASE_PATH}/search/`} className="not-found-search">
        <input type="search" name="q" placeholder="搜尋文章" aria-label="搜尋文章" />
      </form>
      <LatestPosts />
      <p>
        <Link href="/">回到首頁</Link>
      </p>
    </>
  );
}
