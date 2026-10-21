"use client";

import { useEffect, useRef, useState } from "react";
import type { Heading } from "../../../content/headings.ts";

// A heading counts as read once its top passes this line; headings land at 16px (scroll-margin-top).
const ACTIVE_LINE = 32;

/**
 * The article's table of contents: a sidebar fixed left of the article on wide screens, a drawer
 * behind a 目錄 button on narrow ones. Highlights the section being read.
 */
export function ArticleToc({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState<string | undefined>(headings[0]?.id);
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const targets = headings.map((h) => document.getElementById(h.id)).filter((el) => el !== null);
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
      // At the bottom the last sections may never reach the line; the last one is what the reader sees.
      const atBottom = scrollTop + clientHeight >= scrollHeight - 2;
      const passed = targets.filter((el) => el.getBoundingClientRect().top <= ACTIVE_LINE);
      const current = atBottom ? targets.at(-1) : (passed.at(-1) ?? targets[0]);
      setActive(current?.id);
    };
    update();
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    return () => {
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, [headings]);

  useEffect(() => {
    if (!open) return;
    navRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <nav className="toc" id="toc" aria-label="目錄" data-open={open || undefined} tabIndex={-1} ref={navRef}>
        <p className="toc-title">
          目錄
          <button type="button" className="toc-close" aria-label="關閉目錄" onClick={() => setOpen(false)}>
            ✕
          </button>
        </p>
        <ul>
          {headings.map((h) => (
            <li key={h.id} className={h.depth === 3 ? "toc-sub" : undefined}>
              <a
                href={`#${h.id}`}
                aria-current={h.id === active ? "location" : undefined}
                onClick={() => setOpen(false)}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <button
        type="button"
        className="toc-toggle"
        aria-controls="toc"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        ref={toggleRef}
      >
        ☰ 目錄
      </button>
      {open && <div className="toc-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
    </>
  );
}
