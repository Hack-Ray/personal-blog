import type { Metadata } from "next";
import Link from "next/link";
import { loadSiteContent } from "../content/load.ts";
import { pinned, published } from "../content/queries.ts";
import { absoluteUrl } from "../site.ts";
import { ArticleList } from "./article-list.tsx";

export const metadata: Metadata = { alternates: { canonical: absoluteUrl("/") } };

const LATEST = 5;

export default function HomePage() {
  const content = loadSiteContent();
  const top = pinned(content);
  const latest = published(content)
    .filter((a) => !a.pinnedAt)
    .slice(0, LATEST);
  return (
    <>
      <h1>最新文章</h1>
      <ArticleList articles={[...top, ...latest]} showPinned />
      <p>
        <Link href="/posts/">所有文章</Link>
      </p>
    </>
  );
}
