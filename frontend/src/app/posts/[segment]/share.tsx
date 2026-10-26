"use client";

import { useEffect, useState } from "react";
import { shareLinks } from "../../../content/share.ts";

const COPIED_MS = 2000;

export function Share({ url, title }: { url: string; title: string }) {
  const [canCopy, setCanCopy] = useState(false);
  const [label, setLabel] = useState("複製連結");

  useEffect(() => setCanCopy(Boolean(navigator.clipboard)), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setLabel("已複製");
    } catch {
      setLabel("複製失敗");
    }
    setTimeout(() => setLabel("複製連結"), COPIED_MS);
  };

  return (
    <section className="share" aria-label="分享這篇文章">
      <span className="meta">分享</span>
      {shareLinks(url, title).map((l) => (
        <a key={l.name} href={l.href} target="_blank" rel="noopener noreferrer">
          {l.name}
        </a>
      ))}
      {canCopy && (
        <button type="button" onClick={copy} aria-live="polite">
          {label}
        </button>
      )}
    </section>
  );
}
