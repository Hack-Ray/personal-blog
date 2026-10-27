import { createHash } from "node:crypto";

export const MUTABLE_CACHE = "public, max-age=0, s-maxage=60, must-revalidate";
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/** Headers a meta tag cannot carry; static, so a CDN rule can apply them to every response. */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

const CHARSET_META = '<meta charSet="utf-8"/>';

/** Hash exact script bytes from the final HTML, including Next's inline payloads. */
export function contentSecurityPolicy(html: string): string {
  const hashes = new Set<string>();
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/.test(attributes!) || !body) continue;
    hashes.add(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  }
  return [
    "default-src 'self'",
    `script-src 'self' https://giscus.app ${[...hashes].sort().join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline' https://giscus.app",
    "img-src 'self' https: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src https://giscus.app",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** The meta must follow the charset tag and precede every script, or the policy misses them. */
export function withCspMeta(html: string): string {
  if (!html.includes(CHARSET_META)) throw new Error(`Page has no ${CHARSET_META}; cannot place the CSP meta`);
  const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(html)}"/>`;
  return html.replace(CHARSET_META, () => CHARSET_META + meta);
}

export function cacheControl(path: string): string {
  return path.startsWith("_next/static/") || /^(?:images|thumbs)\/[a-f0-9]{64}\.[a-z0-9]+$/.test(path)
    ? IMMUTABLE_CACHE
    : MUTABLE_CACHE;
}
