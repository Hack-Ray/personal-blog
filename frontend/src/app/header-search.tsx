"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BASE_PATH } from "../site.ts";
import { onQueryChange, readQuery, writeQuery } from "./search/query.ts";

export function HeaderSearch() {
  const onSearchPage = usePathname() === "/search/";
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!onSearchPage) return setQuery("");
    const sync = () => setQuery(readQuery());
    sync();
    return onQueryChange(sync);
  }, [onSearchPage]);

  return (
    <form
      role="search"
      method="get"
      action={`${BASE_PATH}/search/`}
      onSubmit={(e) => onSearchPage && e.preventDefault()}
    >
      <input
        type="search"
        name="q"
        aria-label="搜尋文章"
        placeholder="搜尋文章"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (onSearchPage) writeQuery(e.target.value);
        }}
      />
    </form>
  );
}
