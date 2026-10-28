import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The behaviour is tested on the site (frontend/src/content/article-syntax.test.ts).
test("the copy matches the site's article-syntax.ts below its header comment", () => {
  const body = (path: string) =>
    readFileSync(new URL(path, import.meta.url), "utf8").replace(/^[\s\S]*?\nexport const escapeHtml/, "");
  assert.equal(body("./article-syntax.ts"), body("../../frontend/src/content/article-syntax.ts"));
});
