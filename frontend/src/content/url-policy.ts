import { Marked } from "marked";

// Articles may not run code on the page: raw HTML is shown as text, and only
// these URLs become links or images (docs/backlog.md, 文章不允許原始 HTML).
// cms/src/url-policy.ts is a copy; both are tested against
// test-fixtures/url-policy.json.

const lexer = new Marked();
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// marked writes the URL into the attribute as written, so the browser decodes
// character references first: "&#106;avascript:" and "java&colon;" both run as
// javascript:. Named references that decode to ASCII are the only ones that
// can spell a scheme.
const NAMED: Record<string, string> = {
  tab: "\t", newline: "\n", colon: ":", sol: "/", bsol: "\\", amp: "&", period: ".", num: "#",
  quest: "?", percnt: "%", plus: "+", lowbar: "_", commat: "@", semi: ";", equals: "=",
};
const decode = (url: string) =>
  url
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)))
    .replace(/&#([0-9]+);?/g, (_, dec: string) => String.fromCodePoint(Math.min(parseInt(dec, 10), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (ref, name: string) => NAMED[name.toLowerCase()] ?? ref);

// Browsers drop tabs and newlines inside a URL and ignore leading control
// characters and spaces, so "java\tscript:" still runs as javascript:.
const normalize = (url: string) =>
  decode(url).replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+/, "");

/** https:, http:, mailto:, #anchors and relative paths. */
export function allowedLink(href: string): boolean {
  const url = normalize(href);
  if (/^(https?|mailto):/i.test(url)) return true;
  // "//host", "\\host" and "/\\host" all leave the site.
  return !SCHEME.test(url) && !/^[/\\]{2}/.test(url);
}

/** Snapshot images (images/…) and https: images. */
export function allowedImage(src: string): boolean {
  const url = normalize(src);
  return url.startsWith("images/") || /^https:/i.test(url);
}

/** Link and image URLs in the Markdown that the site will not output. */
export function blockedUrls(markdown: string): string[] {
  const blocked: string[] = [];
  lexer.walkTokens(lexer.lexer(markdown), (token) => {
    if (token.type === "link" && !allowedLink(token.href)) blocked.push(token.href);
    if (token.type === "image" && !allowedImage(token.href)) blocked.push(token.href);
  });
  return blocked;
}
