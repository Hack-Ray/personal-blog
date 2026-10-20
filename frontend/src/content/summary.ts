const MAX = 120;
const UPLOADED_IMAGE = /!\[[^\]]*\]\((images\/[^)\s]+)\)/;
const CODE_BLOCK = /```[\s\S]*?```/g;

/** Markdown reduced to its readable text, without code or image syntax. */
export function plainText(markdown: string): string {
  return markdown
    .replace(CODE_BLOCK, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Plain-text opening of an article for meta descriptions. */
export function summary(markdown: string): string {
  const text = plainText(markdown);
  return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
}

/** Snapshot path (images/<file>) of the first uploaded image shown in an article, if any. */
export function firstImage(markdown: string): string | undefined {
  return markdown.replace(CODE_BLOCK, " ").match(UPLOADED_IMAGE)?.[1];
}
