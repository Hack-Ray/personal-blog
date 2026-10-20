import { Marked } from "marked";

// Drafts reference images as images/<id>, the snapshot path; in the editor
// they are served by the API.
const marked = new Marked({
  walkTokens(token) {
    if (token.type === "image" && token.href.startsWith("images/")) token.href = `/api/${token.href}`;
  },
});

export const renderPreview = (markdown: string): string => marked.parse(markdown, { async: false });
