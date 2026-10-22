import { Marked, type Tokens } from "marked";
import { allowedImage, allowedLink } from "./url-policy.ts";

// Mirrors frontend/src/content/markdown.ts so the preview looks like the
// published article: Shiki highlighting with the same themes, figures with
// captions, the external-link marker, and raw HTML and disallowed URLs shown as text.

// Imported one by one so the build bundles only these, not every Shiki grammar.
const LANGS = () => [
  import("shiki/dist/langs/ts.mjs"), import("shiki/dist/langs/tsx.mjs"), import("shiki/dist/langs/js.mjs"),
  import("shiki/dist/langs/jsx.mjs"), import("shiki/dist/langs/json.mjs"), import("shiki/dist/langs/bash.mjs"),
  import("shiki/dist/langs/sh.mjs"), import("shiki/dist/langs/python.mjs"), import("shiki/dist/langs/go.mjs"),
  import("shiki/dist/langs/rust.mjs"), import("shiki/dist/langs/java.mjs"), import("shiki/dist/langs/c.mjs"),
  import("shiki/dist/langs/cpp.mjs"), import("shiki/dist/langs/csharp.mjs"), import("shiki/dist/langs/sql.mjs"),
  import("shiki/dist/langs/yaml.mjs"), import("shiki/dist/langs/html.mjs"), import("shiki/dist/langs/css.mjs"),
  import("shiki/dist/langs/markdown.mjs"), import("shiki/dist/langs/diff.mjs"), import("shiki/dist/langs/dockerfile.mjs"),
];

/** Highlighted HTML for a fenced block, or undefined for a language the site does not highlight. */
export type Highlight = (code: string, lang: string) => string | undefined;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Loaded on demand so the editor does not wait for Shiki; the preview is plain until it arrives. */
export async function loadHighlighter(): Promise<Highlight> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
  ]);
  const highlighter = await createHighlighterCore({
    themes: [import("shiki/dist/themes/github-light.mjs"), import("shiki/dist/themes/github-dark.mjs")],
    langs: LANGS(),
    engine: createJavaScriptRegexEngine(),
  });
  const loaded = new Set(highlighter.getLoadedLanguages());
  return (code, lang) =>
    loaded.has(lang)
      ? highlighter.codeToHtml(code, { lang, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false })
      : undefined;
}

export function renderPreview(markdown: string, highlight?: Highlight): string {
  const marked = new Marked({
    renderer: {
      code({ text, lang }) {
        const name = lang?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
        return `${highlight?.(text, name) ?? `<pre><code>${escapeHtml(text)}</code></pre>`}\n`;
      },
      html: ({ text, block }) => (block ? `<p>${escapeHtml(text.trim())}</p>\n` : escapeHtml(text)),
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (!allowedLink(href)) return inner;
        const attrs = `href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""}`;
        if (!/^https?:\/\//i.test(href)) return `<a ${attrs}>${inner}</a>`;
        const onlyImage = tokens.every((t) => t.type === "image");
        return `<a ${attrs} target="_blank" rel="noopener noreferrer"${onlyImage ? "" : ' class="external"'}>${inner}</a>`;
      },
      image: ({ href, title, text }) =>
        href === ""
          ? escapeHtml(text)
          : `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""}>`,
      paragraph({ tokens }) {
        const inner = this.parser.parseInline(tokens);
        const image = tokens.length === 1 && tokens[0]!.type === "image" ? (tokens[0] as Tokens.Image) : undefined;
        if (!image?.text.trim() || image.href === "") return `<p>${inner}</p>\n`;
        return `<figure>${inner}<figcaption>${escapeHtml(image.text)}</figcaption></figure>\n`;
      },
    },
    // Drafts reference images as images/<id>, the snapshot path; in the editor they are served by the API.
    walkTokens(token) {
      if (token.type !== "image") return;
      if (!allowedImage(token.href)) token.href = "";
      else if (token.href.startsWith("images/")) token.href = `/api/${token.href}`;
    },
  });
  return marked.parse(markdown, { async: false });
}
