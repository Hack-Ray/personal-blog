"use client";

import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";

const COPIED_MS = 2000;

const zoomable = (el: EventTarget) => el instanceof HTMLImageElement && !el.closest("a");

/** Rendered article HTML with copy buttons on code blocks and click-to-zoom images. */
export function ArticleBody({ html }: { html: string }) {
  const body = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState<{ src: string; alt: string }>();

  useEffect(() => {
    if (!navigator.clipboard) return;
    body.current?.querySelectorAll<HTMLButtonElement>(".copy-code").forEach((b) => (b.hidden = false));
  }, [html]);

  // Images open from the keyboard as well as by clicking.
  useEffect(() => {
    body.current?.querySelectorAll("img").forEach((img) => {
      if (!zoomable(img)) return;
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", `放大圖片${img.alt ? `：${img.alt}` : ""}`);
    });
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
    if (zoomable(target)) zoom(target as HTMLImageElement);
  };

  const zoom = (img: HTMLImageElement) => setZoomed({ src: img.currentSrc || img.src, alt: img.alt });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === "Enter" || e.key === " ") && zoomable(e.target)) {
      e.preventDefault();
      zoom(e.target as HTMLImageElement);
    }
  };

  return (
    <>
      {/* Markdown comes only from the site author through the CMS. */}
      <div ref={body} className="article-body" onClick={onClick} onKeyDown={onKeyDown} dangerouslySetInnerHTML={{ __html: html }} />
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
