import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { cacheControl, IMMUTABLE_CACHE, MUTABLE_CACHE, securityHeaders } from "./cdn-headers.ts";

test("CSP authorizes exact inline scripts without permitting arbitrary inline JavaScript", () => {
  const script = "\nself.__next_f.push([1, 'payload']);\n";
  const hash = createHash("sha256").update(script).digest("base64");
  const csp = securityHeaders(`<script>${script}</script><script src="/app.js"></script><script>${script}</script>`)["Content-Security-Policy"]!;
  assert.ok(csp.includes(`'sha256-${hash}'`));
  assert.equal(csp.match(new RegExp(hash.replace(/[+]/g, "\\+"), "g"))?.length, 1);
  assert.ok(!csp.split(";").find((d) => d.trim().startsWith("script-src"))!.includes("unsafe-inline"));
  assert.ok(csp.includes("frame-src https://giscus.app"));
  assert.ok(csp.includes("script-src 'self' https://giscus.app"));
  assert.ok(!csp.includes("unsafe-eval"));
});

test("only immutable asset paths receive a year-long cache lifetime", () => {
  assert.equal(cacheControl("_next/static/chunks/a.js"), IMMUTABLE_CACHE);
  assert.equal(cacheControl(`images/${"a".repeat(64)}.webp`), IMMUTABLE_CACHE);
  for (const file of ["index.html", "feed.xml", "sitemap.xml", "robots.txt", "search-index.json", "search-metadata.json", "search-data/2026/chunk.json", "images/cover.webp", "og-default.png"]) {
    assert.equal(cacheControl(file), MUTABLE_CACHE, file);
  }
});
