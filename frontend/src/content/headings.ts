import { type Token, type Tokens, Lexer, marked } from "marked";

export interface Heading {
  depth: 2 | 3;
  text: string;
  id: string;
  /** Inside a quote or list item; these get ids but stay out of the table of contents. */
  nested: boolean;
}

// Ids the article page already uses (article-toc.tsx, page.tsx).
const PAGE_IDS = ["toc", "related-title"];

const TOC_MIN_HEADINGS = 3;

const slugOf = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";

/** Hands out heading ids in document order; repeats, and ids the page
 * already uses, get -2, -3, ... */
export function slugger() {
  const used = new Set<string>(PAGE_IDS);
  return (text: string): string => {
    const base = slugOf(text);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
}

// marked leaves HTML-escaped text in its tokens.
const unescapeHtml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export function inlineText(tokens: Token[]): string {
  return tokens
    .map((t) => ("tokens" in t && t.tokens ? inlineText(t.tokens) : t.type === "html" ? "" : "text" in t ? unescapeHtml(t.text) : ""))
    .join("");
}

/** h2 and h3 headings, nested ones included, with the ids renderMarkdown
 * gives them: walkTokens visits them in the order they are rendered. */
export function headings(markdown: string): Heading[] {
  const next = slugger();
  const tokens = new Lexer().lex(markdown);
  const topLevel = new Set<Token>(tokens);
  const found: Heading[] = [];
  marked.walkTokens(tokens, (t) => {
    if (t.type !== "heading" || (t.depth !== 2 && t.depth !== 3)) return;
    const text = inlineText((t as Tokens.Heading).tokens).trim();
    found.push({ depth: t.depth as 2 | 3, text, id: next(text), nested: !topLevel.has(t) });
  });
  return found;
}

/** Headings for the table of contents; none unless the article is long enough to need one. */
export function tocHeadings(markdown: string): Heading[] {
  const top = headings(markdown).filter((h) => !h.nested);
  return top.length >= TOC_MIN_HEADINGS ? top : [];
}
