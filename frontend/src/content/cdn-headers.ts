import { createHash } from "node:crypto";

export const MUTABLE_CACHE = "public, max-age=0, s-maxage=60, must-revalidate";
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/** Hash exact script bytes from the final HTML, including Next's inline payloads. */
export function securityHeaders(html: string): Record<string, string> {
  const hashes = new Set<string>();
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/.test(attributes!) || !body) continue;
    hashes.add(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  }
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      `script-src 'self' https://giscus.app ${[...hashes].sort().join(" ")}`.trim(),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https: data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-src https://giscus.app",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

export function cacheControl(path: string): string {
  return path.startsWith("_next/static/") || /^(?:images|thumbs)\/[a-f0-9]{64}\.[a-z0-9]+$/.test(path)
    ? IMMUTABLE_CACHE
    : MUTABLE_CACHE;
}
