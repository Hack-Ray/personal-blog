import Link from "next/link";
import { loadSiteContent } from "../content/load.ts";
import { published } from "../content/queries.ts";
import { ArticleList } from "./article-list.tsx";

export default function HomePage() {
  const latest = published(loadSiteContent()).slice(0, 5);
  return (
    <>
      <h1>Personal Blog</h1>
      <h2>最新文章</h2>
      <ArticleList articles={latest} />
      <p>
        <Link href="/posts/">所有文章</Link>
      </p>
    </>
  );
}
