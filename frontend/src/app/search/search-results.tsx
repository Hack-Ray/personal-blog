"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type SearchDoc, search } from "../../content/search.ts";
import { BASE_PATH } from "../../site.ts";
import { onQueryChange, readQuery } from "./query.ts";

const dateFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeZone: "Asia/Taipei" });

export function SearchResults() {
  const [index, setIndex] = useState<SearchDoc[]>();
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const sync = () => setQuery(readQuery());
    sync();
    const unsubscribe = onQueryChange(sync);
    fetch(`${BASE_PATH}/search-index.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setIndex, () => setFailed(true));
    return unsubscribe;
  }, []);

  const hits = useMemo(() => (index ? search(index, query) : []), [index, query]);

  return (
    <>
      {failed && <p className="meta">無法載入搜尋索引。</p>}
      {!query.trim() && <p className="meta">在上方搜尋列輸入關鍵字。</p>}
      {index && query.trim() && <p className="meta">{hits.length} 篇符合</p>}
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
