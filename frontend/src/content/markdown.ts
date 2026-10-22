import { Marked, type Tokens } from "marked";
import { createHighlighter } from "shiki";
import { SITE_ORIGIN } from "../site.ts";
import { inlineText, slugger } from "./headings.ts";
import { allowedImage, allowedLink } from "./url-policy.ts";

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
  if (!loaded.has(lang)) return `<pre><code>${escapeHtml(code)}</code></pre>`;
  // defaultColor false emits only --shiki-light/--shiki-dark; globals.css picks one.
  return highlighter.codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
}

// The copy button stays hidden until ArticleBody's script can make it work.
const codeBlock = (pre: string) =>
  `<div class="code-block">${pre}<button type="button" class="copy-code" aria-live="polite" hidden>複製</button></div>\n`;

const isExternal = (href: string) => /^https?:\/\//i.test(href) && !(SITE_ORIGIN && href.startsWith(`${SITE_ORIGIN}/`));

// Snapshot Markdown references images as images/<file>; the build copies them
// to public/images, which is served under the site's basePath.
export function renderMarkdown(markdown: string, basePath: string): string {
  const idFor = slugger();
  const marked = new Marked({
    renderer: {
      code: ({ text, lang }) => codeBlock(highlight(text, lang)),
      // Raw HTML is shown as text (articles may not run code on the page).
      html: ({ text, block }) => (block ? `<p>${escapeHtml(text.trim())}</p>\n` : escapeHtml(text)),
      // Links to other sites open in a new tab; a link around an image gets no marker.
      // A URL outside the policy keeps its text but is not a link; the build fails on it anyway.
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (!allowedLink(href)) return inner;
        const attrs = `href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""}`;
        if (!isExternal(href)) return `<a ${attrs}>${inner}</a>`;
        const onlyImage = tokens.every((t) => t.type === "image");
        return `<a ${attrs} target="_blank" rel="noopener noreferrer"${onlyImage ? "" : ' class="external"'}>${inner}</a>`;
      },
      // marked leaves the alt text unescaped.
      image: ({ href, title, text }) =>
        href === ""
          ? escapeHtml(text)
          : `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""} loading="lazy">`,
      // An image alone in its paragraph is a figure, captioned with its alt text.
      paragraph({ tokens }) {
        const inner = this.parser.parseInline(tokens);
        const image = tokens.length === 1 && tokens[0]!.type === "image" ? (tokens[0] as Tokens.Image) : undefined;
        if (!image?.text.trim() || image.href === "") return `<p>${inner}</p>\n`;
        return `<figure>${inner}<figcaption>${escapeHtml(image.text)}</figcaption></figure>\n`;
      },
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        // Same order and rule as headings(), so the table of contents links match.
        return depth === 2 || depth === 3
          ? `<h${depth} id="${idFor(inlineText(tokens).trim())}">${inner}</h${depth}>\n`
          : `<h${depth}>${inner}</h${depth}>\n`;
      },
    },
    walkTokens(token) {
      if (token.type !== "image") return;
      if (!allowedImage(token.href)) token.href = "";
      else if (token.href.startsWith("images/")) token.href = `${basePath}/${token.href}`;
    },
  });
  return marked.parse(markdown, { async: false });
}
