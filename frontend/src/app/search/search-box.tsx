"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type SearchDoc, search } from "../../content/search.ts";
import { BASE_PATH } from "../../site.ts";

const dateFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeZone: "Asia/Taipei" });

export function SearchBox() {
  const [index, setIndex] = useState<SearchDoc[]>();
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setQuery(new URLSearchParams(location.search).get("q") ?? "");
    fetch(`${BASE_PATH}/search-index.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setIndex, () => setFailed(true));
  }, []);

  const hits = useMemo(() => (index ? search(index, query) : []), [index, query]);

  const update = (q: string) => {
    setQuery(q);
    history.replaceState(null, "", q ? `?q=${encodeURIComponent(q)}` : location.pathname);
  };

  return (
    <>
      <input
        type="search"
        aria-label="搜尋文章"
        placeholder="輸入關鍵字"
        value={query}
        onChange={(e) => update(e.target.value)}
        autoFocus
      />
      {failed && <p className="meta">無法載入搜尋索引。</p>}
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
