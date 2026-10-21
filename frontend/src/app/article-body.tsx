"use client";

import { type MouseEvent, useEffect, useRef, useState } from "react";

const COPIED_MS = 2000;

/** Rendered article HTML with copy buttons on code blocks and click-to-zoom images. */
export function ArticleBody({ html }: { html: string }) {
  const body = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState<{ src: string; alt: string }>();

  useEffect(() => {
    if (!navigator.clipboard) return;
    body.current?.querySelectorAll<HTMLButtonElement>(".copy-code").forEach((b) => (b.hidden = false));
  }, [html]);

  useEffect(() => {
    if (zoomed) dialog.current?.showModal();
  }, [zoomed]);

  const onClick = async (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>(".copy-code");
    if (button) {
      const code = button.parentElement?.querySelector("pre")?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = "已複製";
      } catch {
        button.textContent = "複製失敗";
      }
      setTimeout(() => (button.textContent = "複製"), COPIED_MS);
      return;
    }
    if (target instanceof HTMLImageElement && !target.closest("a")) {
      setZoomed({ src: target.currentSrc || target.src, alt: target.alt });
    }
  };

  return (
    <>
      {/* Markdown comes only from the site author through the CMS. */}
      <div ref={body} className="article-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      {zoomed && (
        <dialog
          ref={dialog}
          className="image-zoom"
          aria-label={zoomed.alt || "放大圖片"}
          onClose={() => setZoomed(undefined)}
          onClick={() => dialog.current?.close()}
        >
          <img src={zoomed.src} alt={zoomed.alt} />
        </dialog>
      )}
    </>
  );
}
