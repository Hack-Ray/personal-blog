export type Theme = "system" | "light" | "dark";

const KEY = "theme";
export const THEMES: Theme[] = ["system", "light", "dark"];
export const THEME_LABEL: Record<Theme, string> = { system: "跟隨系統", light: "淺色", dark: "深色" };

/** Runs in <head> before first paint so a stored choice never flashes the other theme. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function setTheme(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {}
  // An embedded giscus iframe does not see our attribute, so tell it.
  const frame = document.querySelector<HTMLIFrameElement>("iframe.giscus-frame");
  frame?.contentWindow?.postMessage({ giscus: { setConfig: { theme: giscusTheme(theme) } } }, "https://giscus.app");
}

export const giscusTheme = (theme: Theme): string => (theme === "system" ? "preferred_color_scheme" : theme);
