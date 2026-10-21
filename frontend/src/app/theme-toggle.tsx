"use client";

import { useEffect, useState } from "react";
import { readTheme, setTheme, THEME_LABEL, THEMES, type Theme } from "../theme.ts";

const ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };

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
      <span aria-hidden="true">{ICON[theme]}</span>
    </button>
  );
}
