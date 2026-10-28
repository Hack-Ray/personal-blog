import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { cacheControl, contentSecurityPolicy, IMMUTABLE_CACHE, MUTABLE_CACHE, withCspMeta } from "./cdn-headers.ts";

const CHARSET = '<meta charSet="utf-8"/>';
const HEAD = `<html><head>${CHARSET}<meta name="viewport" content="width=device-width"/>`;

test("CSP authorizes exact inline scripts without permitting arbitrary inline JavaScript", () => {
  const script = "\nself.__next_f.push([1, 'payload']);\n";
  const hash = createHash("sha256").update(script).digest("base64");
  const csp = contentSecurityPolicy(`<script>${script}</script><script src="/app.js"></script><script>${script}</script>`);
  assert.equal(csp.split(`'sha256-${hash}'`).length, 2);
  assert.ok(!csp.split(";").find((d) => d.trim().startsWith("script-src"))!.includes("unsafe-inline"));
  assert.ok(csp.includes("script-src 'self' https://giscus.app"));
  assert.ok(csp.includes("frame-src https://giscus.app"));
  assert.ok(csp.includes("style-src 'self' 'unsafe-inline' https://giscus.app"));
  assert.ok(!csp.includes("unsafe-eval"));
  assert.ok(!csp.includes("frame-ancestors"));
});

test("the CSP meta follows the charset tag and precedes the first script", () => {
  const out = withCspMeta(`${HEAD}<script>a()</script></head></html>`);
  const charset = out.indexOf(CHARSET);
  assert.equal(out.indexOf('<meta http-equiv="Content-Security-Policy"'), charset + CHARSET.length);
  assert.ok(charset < out.indexOf("<script>"));
  assert.ok(out.includes(createHash("sha256").update("a()").digest("base64")));
});

test("a page without the charset tag fails loudly", () => {
  assert.throws(() => withCspMeta("<html><head></head></html>"), /charSet/);
});

test("only immutable asset paths receive a year-long cache lifetime", () => {
  assert.equal(cacheControl("_next/static/chunks/a.js"), IMMUTABLE_CACHE);
  assert.equal(cacheControl(`images/${"a".repeat(64)}.webp`), IMMUTABLE_CACHE);
  assert.equal(cacheControl(`search-data/2026-${"a".repeat(64)}/chunk.json`), IMMUTABLE_CACHE);
  for (const file of ["index.html", "feed.xml", "sitemap.xml", "robots.txt", "search-index.json", "search-metadata.json", "search-data/2026/chunk.json", "images/cover.webp", "og-default.png"]) {
    assert.equal(cacheControl(file), MUTABLE_CACHE, file);
  }
});
