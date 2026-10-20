import { Marked } from "marked";

// Snapshot Markdown references images as images/<file>; the build copies them
// to public/images, which is served under the site's basePath.
export function renderMarkdown(markdown: string, basePath: string): string {
  const marked = new Marked({
    walkTokens(token) {
      if (token.type === "image" && token.href.startsWith("images/")) token.href = `${basePath}/${token.href}`;
    },
  });
  return marked.parse(markdown, { async: false });
}
