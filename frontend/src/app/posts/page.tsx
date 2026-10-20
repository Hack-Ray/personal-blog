import type { Metadata } from "next";
import { loadSiteContent } from "../../content/load.ts";
import { published } from "../../content/queries.ts";
import { absoluteUrl } from "../../site.ts";
import { SortableArticleList } from "./sortable-article-list.tsx";

export const metadata: Metadata = { title: "文章", alternates: { canonical: absoluteUrl("/posts/") } };

export default function PostsPage() {
  return (
    <>
      <h1>文章</h1>
      <SortableArticleList articles={published(loadSiteContent())} />
    </>
  );
}
