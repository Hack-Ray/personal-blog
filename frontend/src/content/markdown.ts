import { Marked } from "marked";
import { createHighlighter } from "shiki";

const LANGS = [
  "ts", "tsx", "js", "jsx", "json", "bash", "sh", "python", "go", "rust", "java",
  "c", "cpp", "csharp", "sql", "yaml", "html", "css", "markdown", "diff", "dockerfile",
];

// Created once so renderMarkdown stays synchronous.
const highlighter = await createHighlighter({ themes: ["github-light", "github-dark"], langs: LANGS });
const loaded = new Set(highlighter.getLoadedLanguages());

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function highlight(code: string, info: string | undefined): string {
  const lang = info?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!loaded.has(lang)) return `<pre><code>${escapeHtml(code)}</code></pre>\n`;
  // defaultColor false emits only --shiki-light/--shiki-dark; globals.css picks one.
  return highlighter.codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
}

// Snapshot Markdown references images as images/<file>; the build copies them
// to public/images, which is served under the site's basePath.
export function renderMarkdown(markdown: string, basePath: string): string {
  const marked = new Marked({
    renderer: {
      code: ({ text, lang }) => highlight(text, lang),
    },
    walkTokens(token) {
      if (token.type === "image" && token.href.startsWith("images/")) token.href = `${basePath}/${token.href}`;
    },
  });
  return marked.parse(markdown, { async: false });
}
