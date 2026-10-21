import type { Metadata } from "next";
import Link from "next/link";
import { loadSiteContent } from "../content/load.ts";
import { published } from "../content/queries.ts";
import { absoluteUrl } from "../site.ts";
import { ArticleList } from "./article-list.tsx";

export const metadata: Metadata = { alternates: { canonical: absoluteUrl("/") } };

export default function HomePage() {
  const latest = published(loadSiteContent()).slice(0, 5);
  return (
    <>
      <h1>最新文章</h1>
      <ArticleList articles={latest} />
      <p>
        <Link href="/posts/">所有文章</Link>
      </p>
    </>
  );
}
