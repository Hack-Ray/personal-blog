import Link from "next/link";
import { loadSiteContent } from "../../content/load.ts";
import { page } from "../../content/queries.ts";
import { ArticleList } from "../article-list.tsx";

export const pageHref = (n: number) => (n === 1 ? "/posts/" : `/posts/page/${n}/`);

/** One page of /posts/; page 1 is /posts/ itself. */
export function PostIndex({ n }: { n: number }) {
  const { articles, pages } = page(loadSiteContent(), n);
  return (
    <>
      <h1>文章</h1>
      <p className="meta">
        <Link href="/archive/">依年份瀏覽所有文章（可由舊到新排序）</Link>
      </p>
      <ArticleList articles={articles} />
      {pages > 1 && (
        <nav className="pagination" aria-label="分頁">
          {n > 1 && (
            <Link href={pageHref(n - 1)} rel="prev">
              ← 上一頁
            </Link>
          )}
          <span className="meta">
            第 {n} 頁，共 {pages} 頁
          </span>
          {n < pages && (
            <Link href={pageHref(n + 1)} rel="next">
              下一頁 →
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
