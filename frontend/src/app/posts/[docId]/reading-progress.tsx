"use client";

import { useEffect, useState } from "react";

/** A bar showing how far the reader is through the page, and a back-to-top button once they scroll past the first screen. */
export function ReadingProgress() {
  const [progress, setProgress] = useState(0);
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
      const scrollable = scrollHeight - clientHeight;
      setProgress(scrollable > 0 ? Math.min(1, scrollTop / scrollable) : 1);
      setShowTop(scrollTop > clientHeight);
    };
    update();
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    return () => {
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, []);

  return (
    <>
      <div className="reading-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
      <button
        type="button"
        // Hidden by opacity, not display: hiding the focused button mid-scroll cancels Chrome's smooth scroll.
        className={showTop ? "back-to-top shown" : "back-to-top"}
        tabIndex={showTop ? 0 : -1}
        aria-hidden={!showTop}
        aria-label="回到頂端"
        onClick={() => scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
      >
        ↑
      </button>
    </>
  );
}
