import { type Token, type Tokens, Lexer } from "marked";

export interface Heading {
  depth: 2 | 3;
  text: string;
  id: string;
}

const TOC_MIN_HEADINGS = 3;

const slugOf = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";

/** Hands out heading ids in document order; repeats get -2, -3, ... */
export function slugger() {
  const used = new Set<string>();
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

/** h2 and h3 headings with the same ids renderMarkdown gives them. */
export function headings(markdown: string): Heading[] {
  const next = slugger();
  return new Lexer()
    .lex(markdown)
    .filter((t): t is Tokens.Heading => t.type === "heading" && (t.depth === 2 || t.depth === 3))
    .map((t) => {
      const text = inlineText(t.tokens).trim();
      return { depth: t.depth as 2 | 3, text, id: next(text) };
    });
}

/** Headings for the table of contents; none unless the article is long enough to need one. */
export function tocHeadings(markdown: string): Heading[] {
  const all = headings(markdown);
  return all.length >= TOC_MIN_HEADINGS ? all : [];
}
