import { Marked, type Tokens } from "marked";
import type { MouseEvent } from "react";
import {
  articleSyntax,
  type DiagramTheme,
  diagramHtml,
  diagramSvg,
  diagramTitle,
  isMermaid,
  mermaidConfig,
} from "./article-syntax.ts";
import { allowedImage, allowedLink } from "./url-policy.ts";

// Mirrors frontend/src/content/markdown.ts so the preview looks like the
// published article: Shiki highlighting with the same themes, figures with
// captions, the external-link marker, footnotes, callouts and Mermaid diagrams,
// and raw HTML and disallowed URLs shown as text.

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
    themes: [import("shiki/dist/themes/github-light-high-contrast.mjs"), import("shiki/dist/themes/github-dark-default.mjs")],
    langs: LANGS(),
    engine: createJavaScriptRegexEngine(),
  });
  const loaded = new Set(highlighter.getLoadedLanguages());
  return (code, lang) =>
    loaded.has(lang)
      ? highlighter.codeToHtml(code, { lang, themes: { light: "github-light-high-contrast", dark: "github-dark-default" }, defaultColor: false })
      : undefined;
}

/** Diagram HTML for a Mermaid source, or undefined while it is not rendered yet. */
export type Diagram = (source: string) => string | undefined;

/** Renders a Mermaid source in both themes, or to an error message; one at a time, since mermaid.initialize is global. */
export type RenderDiagram = (source: string) => Promise<string>;

let mermaid: Promise<RenderDiagram> | undefined;
let rendered = 0;

/** The site renders diagrams at build time; the local CMS loads Mermaid only once a draft has one. */
export function loadMermaid(): Promise<RenderDiagram> {
  mermaid ??= import("mermaid").then(({ default: m }) => {
    let queue = Promise.resolve("");
    return (source) =>
      (queue = queue.then(async () => {
        const id = `preview-diagram-${++rendered}`;
        const svg = async (theme: DiagramTheme) => {
          m.initialize(mermaidConfig(theme));
          return diagramSvg((await m.render(`${id}-${theme}`, source)).svg, diagramTitle(source));
        };
        try {
          return diagramHtml(await svg("light"), await svg("dark"));
        } catch (e) {
          return `<pre class="diagram-error">圖表無法顯示，網站建置也會失敗：${escapeHtml(e instanceof Error ? e.message : String(e))}</pre>\n`;
        }
      }));
  });
  return mermaid;
}

export function renderPreview(markdown: string, highlight?: Highlight, diagram?: Diagram): string {
  const marked = new Marked(articleSyntax(), {
    renderer: {
      code({ text, lang }) {
        if (isMermaid(lang)) return diagram?.(text) ?? `<pre><code>${escapeHtml(text)}</code></pre>\n`;
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

// The CMS routes by the URL hash, so a footnote or other #anchor scrolls the preview instead.
export function scrollToAnchor(e: MouseEvent<HTMLDivElement>) {
  const href = (e.target as HTMLElement).closest("a")?.getAttribute("href");
  if (!href?.startsWith("#") || href.startsWith("#/")) return;
  e.preventDefault();
  e.currentTarget.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ block: "center" });
}
