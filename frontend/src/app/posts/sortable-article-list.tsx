"use client";

import { type ReactNode, useState } from "react";

// Both orders are rendered on the server, so the Markdown helpers ArticleList uses stay out of the client bundle.
export function SortableArticleList({ newest, oldest }: { newest: ReactNode; oldest: ReactNode }) {
  const [newestFirst, setNewestFirst] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setNewestFirst((v) => !v)}>
        {newestFirst ? "由新到舊" : "由舊到新"}
      </button>
      {newestFirst ? newest : oldest}
    </>
  );
}
