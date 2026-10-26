"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { search } from "../../content/search.ts";
import { subscribeSearch, getSearchSnapshot, getServerSearchSnapshot, startSearch } from "./load-index.ts";
import { SearchStatus } from "./search-status.tsx";
import { onQueryChange, readQuery } from "./query.ts";

const dateFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeZone: "Asia/Taipei" });

export function SearchResults() {
  const snapshot = useSyncExternalStore(subscribeSearch, getSearchSnapshot, getServerSearchSnapshot);
  const [loadedQuery, setLoadedQuery] = useState<string>();

  useEffect(() => {
    const sync = () => setLoadedQuery(readQuery());
    sync();
    const unsubscribe = onQueryChange(sync);
    void startSearch();
    return unsubscribe;
  }, []);

  const hits = useMemo(() => search(snapshot.docs, loadedQuery ?? ""), [snapshot.docs, loadedQuery]);

  return (
    <>
      {loadedQuery?.trim() === "" && <p className="meta">在上方搜尋列輸入關鍵字。</p>}
      <SearchStatus snapshot={snapshot} count={loadedQuery?.trim() ? hits.length : undefined} />
      <ul className="article-list">
        {hits.map(({ doc }) => (
          <li key={doc.docId}>
            <Link href={doc.path}>{doc.title}</Link>
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
