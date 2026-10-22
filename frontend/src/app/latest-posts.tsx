"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BASE_PATH } from "../site.ts";

// Every page's payload carries the 404 page, so it fetches the latest posts
// at runtime instead of embedding them.
export function LatestPosts() {
  const [docs, setDocs] = useState<{ docId: string; title: string }[]>([]);
  useEffect(() => {
    fetch(`${BASE_PATH}/latest-posts.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setDocs, () => {});
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
