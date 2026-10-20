"use client";

import { useState } from "react";
import type { PublishedArticle } from "../../content/model.ts";
import { ArticleList } from "../article-list.tsx";

export function SortableArticleList({ articles }: { articles: PublishedArticle[] }) {
  const [newestFirst, setNewestFirst] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setNewestFirst((v) => !v)}>
        {newestFirst ? "由新到舊" : "由舊到新"}
      </button>
      <ArticleList articles={newestFirst ? articles : articles.toReversed()} />
    </>
  );
}
