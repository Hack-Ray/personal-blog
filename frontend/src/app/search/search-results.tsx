"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type SearchDoc, search } from "../../content/search.ts";
import { loadIndex } from "./load-index.ts";
import { onQueryChange, readQuery } from "./query.ts";

const dateFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeZone: "Asia/Taipei" });

export function SearchResults() {
  const [index, setIndex] = useState<SearchDoc[]>();
  const [failed, setFailed] = useState(false);
  const [loadedQuery, setLoadedQuery] = useState<string>();

  useEffect(() => {
    const sync = () => setLoadedQuery(readQuery());
    sync();
    const unsubscribe = onQueryChange(sync);
    loadIndex().then(setIndex, () => setFailed(true));
    return unsubscribe;
  }, []);

  const hits = useMemo(() => (index && loadedQuery ? search(index, loadedQuery) : []), [index, loadedQuery]);

  return (
    <>
      {failed && <p className="meta">無法載入搜尋索引。</p>}
      {loadedQuery?.trim() === "" && <p className="meta">在上方搜尋列輸入關鍵字。</p>}
      <p className="meta" role="status">
        {index && loadedQuery?.trim() ? `${hits.length} 篇符合` : ""}
      </p>
      <ul className="article-list">
        {hits.map(({ doc }) => (
          <li key={doc.docId}>
            <Link href={`/posts/${doc.docId}/`}>{doc.title}</Link>
            <p className="meta">
              {dateFormat.format(new Date(doc.publishedAt))} · {doc.topic}
              {doc.tags.map((t) => ` · #${t}`).join("")}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
