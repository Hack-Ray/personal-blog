"use client";

import { type ReactNode, useEffect, useState } from "react";
import { readTheme, setTheme, THEME_LABEL, THEMES, type Theme } from "../theme.ts";

// Inline SVG: the ◐ ☀ ☾ glyphs are missing or tiny in common system fonts.
const ICON: Record<Theme, ReactNode> = {
  system: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
};

export function ThemeToggle() {
  const [theme, setCurrent] = useState<Theme>("system");
  useEffect(() => setCurrent(readTheme()), []);

  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`色彩模式：${THEME_LABEL[theme]}，切換為${THEME_LABEL[next]}`}
      title={`色彩模式：${THEME_LABEL[theme]}`}
      onClick={() => {
        setTheme(next);
        setCurrent(next);
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        {ICON[theme]}
      </svg>
    </button>
  );
}
