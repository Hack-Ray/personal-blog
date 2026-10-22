"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { search } from "../content/search.ts";
import { BASE_PATH } from "../site.ts";
import { subscribeSearch, getSearchSnapshot, getServerSearchSnapshot, startSearch } from "./search/load-index.ts";
import { SearchStatus } from "./search/search-status.tsx";
import { onQueryChange, readQuery, writeQuery } from "./search/query.ts";

const PREVIEW_LIMIT = 5;

export function HeaderSearch() {
  const pathname = usePathname();
  const onSearchPage = pathname === "/search/";
  const [query, setQuery] = useState("");
  const snapshot = useSyncExternalStore(subscribeSearch, getSearchSnapshot, getServerSearchSnapshot);
  const [open, setOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!onSearchPage) return setQuery("");
    const sync = () => setQuery(readQuery());
    sync();
    return onQueryChange(sync);
  }, [onSearchPage, pathname]);

  useEffect(() => setOpen(false), [pathname]);

  // Safari doesn't focus a tapped link, so a blur can't tell a tap on a result from a tap
  // outside; close on presses outside the form instead.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!form.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const hits = useMemo(() => search(snapshot.docs, query), [snapshot.docs, query]);
  const showPreview = open && !onSearchPage && query.trim() !== "";

  return (
    <form
      ref={form}
      role="search"
      method="get"
      action={`${BASE_PATH}/search/`}
      onSubmit={(e) => onSearchPage && e.preventDefault()}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        // relatedTarget is null on a tap; only a Tab out of the form closes here.
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <input
        type="search"
        name="q"
        aria-label="搜尋文章"
        placeholder="搜尋文章"
        autoComplete="off"
        onFocus={() => { void startSearch(); }}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (onSearchPage) writeQuery(e.target.value);
        }}
      />
      {showPreview && (
        <div className="search-preview">
          <SearchStatus snapshot={snapshot} count={hits.length} />
          {hits.length > 0 && (
            <ul>
              {hits.slice(0, PREVIEW_LIMIT).map(({ doc }) => (
                <li key={doc.docId}>
                  <Link href={`/posts/${doc.docId}/`}>{doc.title}</Link>
                  <span className="meta">
                    {doc.topic}
                    {doc.tags.map((t) => ` · #${t}`).join("")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {hits.length > PREVIEW_LIMIT && (
            <Link href={`/search/?q=${encodeURIComponent(query)}`} className="meta">
              查看全部 {hits.length} 篇
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
