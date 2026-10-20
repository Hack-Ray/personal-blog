const MAX = 120;

/** Markdown reduced to its readable text, without code or image syntax. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
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
