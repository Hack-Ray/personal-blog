import { Marked, marked, type MarkedExtension, type Token, type Tokens } from "marked";

// Footnotes, callouts and Mermaid diagrams, the Markdown articles add to
// CommonMark (FE-023). cms/src/article-syntax.ts is a copy, so the preview
// renders them like the site.

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// GitHub alert kinds, with Octicons (MIT) icon paths; globals.css colours each callout-<kind>.
const CALLOUTS = new Map<string, { label: string; icon: string }>([
  ["note", { label: "注意", icon: "M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" }],
  ["tip", { label: "提示", icon: "M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z" }],
  ["important", { label: "重要", icon: "M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" }],
  ["warning", { label: "警告", icon: "M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" }],
  ["caution", { label: "小心", icon: "M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" }],
]);

const CALLOUT_MARKER = /^\[!([a-z]+)\][ \t]*(?:\n|$)/i;

/** The body of a blockquote that opens with a known [!KIND] line, without that line. */
function callout(quote: Tokens.Blockquote): { kind: string; body: Token[] } | undefined {
  const [first, ...rest] = quote.tokens;
  const marker = first?.type === "paragraph" ? CALLOUT_MARKER.exec(first.text) : null;
  const kind = marker?.[1]!.toLowerCase();
  if (!marker || !kind || !CALLOUTS.has(kind)) return undefined;
  // The marker is plain text, so it spans only the paragraph's leading text tokens.
  const inline = [...(first as Tokens.Paragraph).tokens];
  for (let n = marker[0].length; n > 0; ) {
    const t = inline[0];
    if (t?.type !== "text") return undefined;
    if (t.raw.length <= n) {
      n -= t.raw.length;
      inline.shift();
    } else {
      inline[0] = { ...t, raw: t.raw.slice(n), text: t.text.slice(n) } as Tokens.Text;
      n = 0;
    }
  }
  const p = first as Tokens.Paragraph;
  const body = inline.length > 0 ? [{ ...p, text: p.text.slice(marker[0].length), tokens: inline }, ...rest] : rest;
  return { kind, body };
}

interface FootnoteDef {
  type: "footnoteDef";
  raw: string;
  label: string;
  // Not named tokens, so marked does not walk a note where it is written, only in the footnotes section.
  content: Token[];
}

interface FootnoteRef {
  type: "footnoteRef";
  raw: string;
  label: string;
  number?: number;
  occurrence?: number;
}

interface FootnoteItem {
  type: "footnote";
  raw: "";
  number: number;
  refs: number;
  tokens: Token[];
}

// Heading ids from headings.ts never contain "_", so these cannot collide with them.
const noteId = (n: number) => `fn_${n}`;
const refId = (n: number, occurrence: number) => (occurrence > 1 ? `fnref_${n}_${occurrence}` : `fnref_${n}`);
const FOOTNOTES_HEADING_ID = "footnotes_heading";

const FOOTNOTE_DEF = /^ {0,3}\[\^([^\]\s]+)\]:([^\n]*(?:\n(?:[ \t]*\n)*(?: {4}|\t)[^\n]*)*)/;
const FOOTNOTE_REF = /^\[\^([^\]\s]+)\]/;

/** Footnotes ([^1] and [^1]: …) and callouts (> [!NOTE]); create one per parse. */
export function articleSyntax(): MarkedExtension {
  const defs = new Map<string, FootnoteDef>();
  return {
    hooks: {
      preprocess(src) {
        defs.clear();
        return src;
      },
      // Numbers notes by first reference, body first, then references inside notes, and appends the section.
      processAllTokens(tokens) {
        const order: FootnoteDef[] = [];
        const counts = new Map<FootnoteDef, number>();
        const visit = (ts: Token[]) =>
          marked.walkTokens(ts, (t) => {
            if (t.type !== "footnoteRef") return;
            const ref = t as FootnoteRef;
            const def = defs.get(ref.label)!;
            if (!counts.has(def)) order.push(def);
            const occurrence = (counts.get(def) ?? 0) + 1;
            counts.set(def, occurrence);
            ref.number = order.indexOf(def) + 1;
            ref.occurrence = occurrence;
          });
        visit(tokens);
        for (let i = 0; i < order.length; i++) visit(order[i]!.content);
        if (order.length === 0) return tokens;
        const items: FootnoteItem[] = order.map((def, i) => ({
          type: "footnote",
          raw: "",
          number: i + 1,
          refs: counts.get(def)!,
          tokens: def.content,
        }));
        return [...tokens, { type: "footnotes", raw: "", tokens: items } as Tokens.Generic];
      },
    },
    extensions: [
      {
        name: "footnoteDef",
        level: "block",
        start: (src) => src.match(/^ {0,3}\[\^[^\]\s]+\]:/m)?.index,
        tokenizer(src) {
          const m = FOOTNOTE_DEF.exec(src);
          if (!m) return undefined;
          const [first, ...rest] = m[2]!.split("\n");
          const text = [first!.trim(), ...rest.map((l) => l.replace(/^(?: {4}|\t)/, ""))].join("\n");
          const label = m[1]!.toLowerCase();
          const def: FootnoteDef = { type: "footnoteDef", raw: m[0], label, content: this.lexer.blockTokens(text, []) };
          if (!defs.has(label)) defs.set(label, def);
          return def;
        },
        renderer: () => "",
      },
      {
        name: "footnoteRef",
        level: "inline",
        start: (src) => src.indexOf("[^"),
        tokenizer(src) {
          const m = FOOTNOTE_REF.exec(src);
          if (!m || !defs.has(m[1]!.toLowerCase())) return undefined;
          return { type: "footnoteRef", raw: m[0], label: m[1]!.toLowerCase() } satisfies FootnoteRef;
        },
        renderer(token) {
          const { raw, number, occurrence } = token as FootnoteRef;
          if (!number || !occurrence) return escapeHtml(raw);
          return `<sup class="footnote-ref"><a id="${refId(number, occurrence)}" href="#${noteId(number)}" aria-describedby="${FOOTNOTES_HEADING_ID}">${number}</a></sup>`;
        },
      },
      {
        name: "footnotes",
        renderer(token) {
          const items = (token.tokens as FootnoteItem[]).map(({ number, refs, tokens }) => {
            const back = Array.from({ length: refs }, (_, i) => {
              const mark = i === 0 ? "↩︎" : `↩︎<sup>${i + 1}</sup>`;
              return ` <a href="#${refId(number, i + 1)}" class="footnote-backref" aria-label="回到註腳 ${number} ${refs > 1 ? `的第 ${i + 1} 個` : "的"}引用處">${mark}</a>`;
            }).join("");
            const html = this.parser.parse(tokens).trimEnd();
            const body = html.endsWith("</p>") ? `${html.slice(0, -"</p>".length)}${back}</p>` : `${html}<p>${back.trim()}</p>`;
            return `<li id="${noteId(number)}">${body}</li>\n`;
          });
          return `<section class="footnotes" aria-labelledby="${FOOTNOTES_HEADING_ID}">\n<h2 id="${FOOTNOTES_HEADING_ID}">註腳</h2>\n<ol>\n${items.join("")}</ol>\n</section>\n`;
        },
      },
      {
        name: "blockquote",
        renderer(token) {
          const found = callout(token as Tokens.Blockquote);
          if (!found) return false;
          const { label, icon } = CALLOUTS.get(found.kind)!;
          const svg = `<svg class="callout-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${icon}"></path></svg>`;
          return `<div class="callout callout-${found.kind}" role="note">\n<p class="callout-title">${svg}${label}</p>\n${this.parser.parse(found.body)}</div>\n`;
        },
      },
    ],
  };
}

export const isMermaid = (lang: string | undefined) => lang?.trim().split(/\s+/)[0]?.toLowerCase() === "mermaid";

/** The source of every Mermaid block, notes included, in document order. */
export function mermaidSources(markdown: string): string[] {
  const m = new Marked(articleSyntax());
  const found: string[] = [];
  const visit = (t: Token) => {
    if (t.type === "code" && isMermaid(t.lang)) found.push(t.text);
    if (t.type === "footnoteDef") m.walkTokens((t as FootnoteDef).content, visit);
  };
  m.walkTokens(m.lexer(markdown), visit);
  return found;
}

export type DiagramTheme = "light" | "dark";

/** Options for mermaid.initialize; labels are SVG text, so the output has no HTML in it. */
export const mermaidConfig = (theme: DiagramTheme) => ({
  startOnLoad: false,
  securityLevel: "strict" as const,
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  theme: theme === "dark" ? ("dark" as const) : ("default" as const),
  fontFamily: 'system-ui, "Noto Sans TC", sans-serif',
});

/** The accessible name of a diagram: its "%% title: …" line, or a generic one. */
export function diagramTitle(source: string): string {
  return /^[ \t]*%%[ \t]*title:?[ \t]+(.+)$/im.exec(source)?.[1]!.trim() || "圖表";
}

const UNSAFE_SVG = /<(?:script|foreignObject|iframe|object|embed)\b|\son[a-z]+\s*=|\s(?:xlink:)?href\s*=\s*"(?!#)|javascript:/i;

/** Mermaid's SVG as an image named label; throws if it carries anything that could run or embed HTML. */
export function diagramSvg(svg: string, label: string): string {
  const unsafe = UNSAFE_SVG.exec(svg);
  if (unsafe) throw new Error(`the SVG contains ${unsafe[0].trim()}`);
  return svg.replace(/^<svg\b([^>]*)>/, (_, attrs: string) =>
    `<svg${attrs.replace(/\s(?:role|aria-roledescription|aria-labelledby|aria-describedby)="[^"]*"/g, "")} role="img" aria-label="${escapeHtml(label)}">`,
  );
}

/** Both theme variants; the stylesheet shows the one for the active theme. */
export const diagramHtml = (light: string, dark: string) =>
  `<div class="diagram"><div class="diagram-light">${light}</div><div class="diagram-dark">${dark}</div></div>\n`;
