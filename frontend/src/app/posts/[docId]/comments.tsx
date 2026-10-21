"use client";

import { useEffect, useRef } from "react";

// IDs come from https://giscus.app for Hack-Ray/personal-blog and its Announcements category.
const GISCUS = {
  repo: "Hack-Ray/personal-blog",
  repoId: "",
  category: "Announcements",
  categoryId: "",
};

/** giscus thread keyed by docId, so a new title, domain or basePath keeps the same discussion. */
export function Comments({ docId }: { docId: string }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const script = document.createElement("script");
    Object.entries({
      src: "https://giscus.app/client.js",
      "data-repo": GISCUS.repo,
      "data-repo-id": GISCUS.repoId,
      "data-category": GISCUS.category,
      "data-category-id": GISCUS.categoryId,
      "data-mapping": "specific",
      "data-term": docId,
      "data-strict": "1",
      "data-reactions-enabled": "1",
      "data-emit-metadata": "0",
      "data-input-position": "top",
      "data-theme": "preferred_color_scheme",
      "data-lang": "zh-TW",
      "data-loading": "lazy",
      crossorigin: "anonymous",
    }).forEach(([k, v]) => script.setAttribute(k, v));
    script.async = true;
    container.replaceChildren(script);
    return () => container.replaceChildren();
  }, [docId]);

  if (!GISCUS.repoId || !GISCUS.categoryId) return null;
  return <section ref={ref} className="comments" aria-label="留言" />;
}
