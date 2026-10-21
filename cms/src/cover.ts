import { Marked } from "marked";

const marked = new Marked();

/** Ids of the uploaded images the Markdown shows, in order; the same rule as the backend and the public site. */
export function imageIds(markdown: string): string[] {
  const ids: string[] = [];
  marked.walkTokens(marked.lexer(markdown), (token) => {
    if (token.type === "image" && token.href.startsWith("images/")) ids.push(token.href.slice("images/".length));
  });
  return [...new Set(ids)];
}
