import { coverOf } from "./card.ts";
import type { PublishedArticle } from "./model.ts";

export const SHARE_IMAGE_WIDTH = 1200;
export const SHARE_IMAGE_HEIGHT = 630;

/** An article's share image as a site path without the leading slash: its cover, else the one the build draws from its title. */
export const shareImageOf = (a: PublishedArticle): string => coverOf(a) ?? `og/${a.docId}.png`;

/** Whether the build draws the article's share image, which is when it has no cover. */
export const hasGeneratedShareImage = (a: PublishedArticle): boolean => coverOf(a) === undefined;

const PADDING = 80;
const TEXT_WIDTH = SHARE_IMAGE_WIDTH - 2 * PADDING;
const TITLE_SIZES = [88, 72, 60];
const MAX_LINES = 3;
const LINE_HEIGHT = 1.32;
const MAX_TITLE_CHARS = 300;
const LATIN_EM = 0.55;
const SPACE_EM = 0.3;
const ELLIPSIS = "…";

export const ICON_SIZE = 64;
export const ICON_POSITION = { left: PADDING, top: 56 };

// A CJK-capable family first; the macOS and Windows names let a local build look the same.
export const FONT_FAMILY = "'Noto Sans CJK TC', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif";

const BACKGROUND = "#0d1117";
const ACCENT = "#4493f8";
const FOREGROUND = "#e6edf3";
const MUTED = "#9198a1";

const NO_LINE_START = new Set([..."，。、．：；！？）」』】》〉…‧,.:;!?)]}"]);
const NO_LINE_END = new Set([..."（「『【《〈([{"]);

const isWide = (c: string): boolean => {
  const cp = c.codePointAt(0)!;
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    cp === 0x2014 ||
    cp === 0x2026 ||
    cp >= 0x1f000
  );
};

/** Whether the text needs a CJK font. */
export const hasCjk = (text: string): boolean => [...text].some(isWide);

type Token = { text: string; em: number; space?: true };

const widthOf = (text: string): number => [...text].reduce((w, c) => w + (isWide(c) ? 1 : LATIN_EM), 0);

function tokenize(text: string, maxEm: number): Token[] {
  const tokens: Token[] = [];
  let word = "";
  const flush = () => {
    if (!word) return;
    // A word wider than a line breaks wherever it has to.
    if (widthOf(word) <= maxEm) tokens.push({ text: word, em: widthOf(word) });
    else for (const c of word) tokens.push({ text: c, em: widthOf(c) });
    word = "";
  };
  for (const c of text) {
    if (c === " ") {
      flush();
      tokens.push({ text: c, em: SPACE_EM, space: true });
    } else if (isWide(c)) {
      flush();
      tokens.push({ text: c, em: 1 });
    } else word += c;
  }
  flush();
  return tokens;
}

const textOf = (line: Token[]): string => line.map((t) => t.text).join("");
const emOf = (line: Token[]): number => line.reduce((w, t) => w + t.em, 0);

function trimEnd(line: Token[]): Token[] {
  while (line.at(-1)?.space) line.pop();
  return line;
}

function breakLines(text: string, maxEm: number): Token[][] {
  const lines: Token[][] = [];
  let line: Token[] = [];
  for (const token of tokenize(text, maxEm)) {
    if (token.space && line.length === 0) continue;
    // A closing mark hangs past the margin instead of starting a line.
    if (!token.space && line.length > 0 && emOf(line) + token.em > maxEm && !NO_LINE_START.has(token.text)) {
      const carried: Token[] = [];
      while (line.length > 1 && NO_LINE_END.has(line.at(-1)!.text)) carried.unshift(line.pop()!);
      lines.push(trimEnd(line));
      line = carried;
    }
    line.push(token);
  }
  if (line.length > 0) lines.push(trimEnd(line));
  return lines;
}

function layout(title: string, maxEm: number, maxLines: number): { lines: string[]; truncated: boolean } {
  const chars = [...title.replace(/\s+/g, " ").trim()];
  const lines = breakLines(chars.slice(0, MAX_TITLE_CHARS).join(""), maxEm);
  if (lines.length <= maxLines && chars.length <= MAX_TITLE_CHARS) return { lines: lines.map(textOf), truncated: false };
  const last = lines[maxLines - 1] ?? [];
  while (last.length > 0 && emOf(last) + 1 > maxEm) last.pop();
  return { lines: [...lines.slice(0, maxLines - 1).map(textOf), textOf(trimEnd(last)) + ELLIPSIS], truncated: true };
}

/**
 * A title's lines, each at most `maxEm` ems wide by an approximate measure: CJK breaks between any two
 * characters, Latin at spaces. A title needing more than `maxLines` ends in an ellipsis.
 */
export const wrapTitle = (title: string, maxEm: number, maxLines = MAX_LINES): string[] => layout(title, maxEm, maxLines).lines;

const escapeXml = (s: string): string =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export interface ShareImageInput {
  title: string;
  siteTitle: string;
  /** Already formatted for display. */
  date?: string;
  topic?: string;
}

/** The 1200x630 share image of an article as SVG; the build composites the site icon in the top left corner (scripts/generate-share-images.ts). */
export function shareImageSvg({ title, siteTitle, date, topic }: ShareImageInput): string {
  const size = TITLE_SIZES.find((s) => !layout(title, TEXT_WIDTH / s, MAX_LINES).truncated) ?? TITLE_SIZES.at(-1)!;
  const { lines } = layout(title, TEXT_WIDTH / size, MAX_LINES);
  const lineHeight = size * LINE_HEIGHT;
  const blockTop = 335 - (lines.length * lineHeight) / 2;
  const tspans = lines
    .map((l, i) => `<tspan x="${PADDING}" y="${(blockTop + i * lineHeight + size * 0.98).toFixed(1)}">${escapeXml(l)}</tspan>`)
    .join("");
  const meta = [topic, date].filter(Boolean).join("  ·  ");
  const [site] = layout(siteTitle, 24, 1).lines;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_IMAGE_WIDTH}" height="${SHARE_IMAGE_HEIGHT}" viewBox="0 0 ${SHARE_IMAGE_WIDTH} ${SHARE_IMAGE_HEIGHT}" font-family="${FONT_FAMILY}">
<rect width="${SHARE_IMAGE_WIDTH}" height="${SHARE_IMAGE_HEIGHT}" fill="${BACKGROUND}"/>
<rect width="${SHARE_IMAGE_WIDTH}" height="8" fill="${ACCENT}"/>
<text x="${PADDING + ICON_SIZE + 22}" y="${ICON_POSITION.top + 44}" font-size="34" font-weight="700" fill="${MUTED}">${escapeXml(site ?? "")}</text>
<text font-size="${size}" font-weight="700" fill="${FOREGROUND}">${tspans}</text>
${meta ? `<text x="${PADDING}" y="570" font-size="30" fill="${MUTED}">${escapeXml(meta)}</text>` : ""}
</svg>
`;
}
