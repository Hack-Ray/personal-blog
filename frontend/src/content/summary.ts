const MAX = 120;
const CODE_BLOCK = /```[\s\S]*?```/g;

/** Markdown reduced to its readable text, without code or image syntax. */
export function plainText(markdown: string): string {
  return markdown
    .replace(CODE_BLOCK, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Autolinks keep their address; anything else shaped like a tag is dropped.
    .replace(/<((?:[a-z][a-z0-9+.-]*:|[^\s<>@]+@)[^\s<>]*)>/gi, "$1")
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?\/?>/gi, " ")
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const graphemes = new Intl.Segmenter();

/** Plain-text opening of an article for meta descriptions, cut between
 * characters as people see them, so an emoji is never split. */
export function summary(markdown: string): string {
  const chars = Array.from(graphemes.segment(plainText(markdown)), (s) => s.segment);
  return chars.length > MAX ? `${chars.slice(0, MAX - 1).join("")}…` : chars.join("");
}
