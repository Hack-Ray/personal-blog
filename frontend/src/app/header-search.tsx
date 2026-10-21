"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { type SearchDoc, search } from "../content/search.ts";
import { BASE_PATH } from "../site.ts";
import { loadIndex } from "./search/load-index.ts";
import { onQueryChange, readQuery, writeQuery } from "./search/query.ts";

const PREVIEW_LIMIT = 5;

export function HeaderSearch() {
  const pathname = usePathname();
  const onSearchPage = pathname === "/search/";
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchDoc[]>();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!onSearchPage) return setQuery("");
    const sync = () => setQuery(readQuery());
    sync();
    return onQueryChange(sync);
  }, [onSearchPage, pathname]);

  useEffect(() => setOpen(false), [pathname]);

  const hits = useMemo(() => (index && query.trim() ? search(index, query) : []), [index, query]);
  // The search page already lists results live, so the dropdown would repeat them.
  const showPreview = open && !onSearchPage && index !== undefined && query.trim() !== "";

  return (
    <form
      role="search"
      method="get"
      action={`${BASE_PATH}/search/`}
      onSubmit={(e) => onSearchPage && e.preventDefault()}
      onFocus={() => {
        setOpen(true);
        loadIndex().then(setIndex, () => {});
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <input
        type="search"
        name="q"
        aria-label="搜尋文章"
        placeholder="搜尋文章"
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (onSearchPage) writeQuery(e.target.value);
        }}
      />
      {showPreview && (
        <div className="search-preview">
          <p className="meta">{hits.length} 篇符合</p>
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
