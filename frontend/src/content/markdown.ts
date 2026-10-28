import { Marked, type Tokens } from "marked";
import { createHighlighter } from "shiki";
import { existsSync, readFileSync } from "node:fs";
import { SITE_ORIGIN } from "../site.ts";
import { inlineText, slugger } from "./headings.ts";
import { DIAGRAMS_FILE, IMAGE_SIZES_FILE } from "./load.ts";
import { articleSyntax, diagramHtml, isMermaid } from "./article-syntax.ts";
import { type Diagrams, diagramKey } from "./diagrams.ts";
import { allowedImage, allowedLink } from "./url-policy.ts";
import { legacySiteUrls, migrateSiteLink } from "./site-links.ts";

const legacyRoots = legacySiteUrls(process.env.LEGACY_SITE_URLS ?? "");

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

type ImageSizes = Record<string, { width: number; height: number }>;

// Written by the build; without it (unit tests, a fresh checkout) images get no size attributes.
const imageSizes: ImageSizes = existsSync(IMAGE_SIZES_FILE) ? JSON.parse(readFileSync(IMAGE_SIZES_FILE, "utf8")) : {};
const renderedDiagrams: Diagrams = existsSync(DIAGRAMS_FILE) ? JSON.parse(readFileSync(DIAGRAMS_FILE, "utf8")) : {};

const isExternal = (href: string) => /^https?:\/\//i.test(href) && !(SITE_ORIGIN && href.startsWith(`${SITE_ORIGIN}/`));

// Snapshot Markdown references images as images/<file>; the build copies them
// to public/images, which is served under the site's basePath.
export function renderMarkdown(
  markdown: string,
  basePath: string,
  sizes: ImageSizes = imageSizes,
  diagrams: Diagrams = renderedDiagrams,
): string {
  const idFor = slugger();
  let imagesSeen = 0;
  const diagramsSeen = new Map<string, number>();
  const diagram = (source: string) => {
    const key = diagramKey(source);
    const svg = diagrams[key];
    if (!svg) throw new Error(`Mermaid diagram ${key} has no rendered SVG; npm run build renders the snapshot's diagrams first (scripts/render-diagrams.ts)`);
    const seen = (diagramsSeen.get(key) ?? 0) + 1;
    diagramsSeen.set(key, seen);
    // A repeat of the same diagram on one page needs its own ids.
    const own = (s: string) => (seen === 1 ? s : s.replaceAll(`mermaid-${key}-`, `mermaid-${key}-${seen}-`));
    return diagramHtml(own(svg.light), own(svg.dark));
  };
  const marked = new Marked(articleSyntax(), {
    renderer: {
      code: ({ text, lang }) => (isMermaid(lang) ? diagram(text) : codeBlock(highlight(text, lang))),
      // Raw HTML is shown as text (articles may not run code on the page).
      html: ({ text, block }) => (block ? `<p>${escapeHtml(text.trim())}</p>\n` : escapeHtml(text)),
      // Links to other sites open in a new tab; a link around an image gets no marker.
      // A URL outside the policy keeps its text but is not a link; the build fails on it anyway.
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (!allowedLink(href)) return inner;
        href = migrateSiteLink(href, basePath, legacyRoots);
        const attrs = `href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""}`;
        if (!isExternal(href)) return `<a ${attrs}>${inner}</a>`;
        const onlyImage = tokens.every((t) => t.type === "image");
        return `<a ${attrs} target="_blank" rel="noopener noreferrer"${onlyImage ? "" : ' class="external"'}>${inner}</a>`;
      },
      // marked leaves the alt text unescaped. walkTokens has put basePath in front of images/ hrefs.
      image({ href, title, text }) {
        if (href === "") return escapeHtml(text);
        const size = href.startsWith(`${basePath}/images/`) ? sizes[href.slice(basePath.length + 1)] : undefined;
        const dims = size ? ` width="${size.width}" height="${size.height}"` : "";
        // The first image is often near the top and the page's largest paint, so it loads right away.
        const loading = imagesSeen++ === 0 ? ' fetchpriority="high"' : ' loading="lazy"';
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""}${dims}${loading} decoding="async">`;
      },
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
