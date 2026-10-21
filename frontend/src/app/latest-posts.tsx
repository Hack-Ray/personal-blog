"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SearchDoc } from "../content/search.ts";
import { loadIndex } from "./search/load-index.ts";

const LATEST = 5;

// Every page's payload carries the 404 page, so it reads the latest posts
// from the search index at runtime instead of embedding them.
export function LatestPosts() {
  const [docs, setDocs] = useState<SearchDoc[]>([]);
  useEffect(() => {
    loadIndex().then((index) => setDocs(index.slice(0, LATEST)), () => {});
  }, []);
  if (docs.length === 0) return null;
  return (
    <>
      <h2>最新文章</h2>
      <ul>
        {docs.map((d) => (
          <li key={d.docId}>
            <Link href={`/posts/${d.docId}/`}>{d.title}</Link>
          </li>
        ))}
      </ul>
    </>
  );
}
