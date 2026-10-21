import type { Metadata } from "next";
import { loadSiteContent } from "../../content/load.ts";
import { published } from "../../content/queries.ts";
import { absoluteUrl } from "../../site.ts";
import { ArticleList } from "../article-list.tsx";
import { SortableArticleList } from "./sortable-article-list.tsx";

export const metadata: Metadata = { title: "文章", alternates: { canonical: absoluteUrl("/posts/") } };

export default function PostsPage() {
  const articles = published(loadSiteContent());
  return (
    <>
      <h1>文章</h1>
      <SortableArticleList
        newest={<ArticleList articles={articles} />}
        oldest={<ArticleList articles={articles.toReversed()} />}
      />
    </>
  );
}
