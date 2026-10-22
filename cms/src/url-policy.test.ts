import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { blockedUrls } from "./url-policy.ts";

// Same cases as the site, so the CMS never accepts what the build rejects.
const cases: { name: string; markdown: string; blocked: string[] }[] = JSON.parse(
  readFileSync(new URL("../../frontend/test-fixtures/url-policy.json", import.meta.url), "utf8"),
);

for (const { name, markdown, blocked } of cases) {
  test(`url policy: ${name}`, () => assert.deepEqual(blockedUrls(markdown), blocked));
}

test("the copy matches the site's url-policy.ts below its header comment", () => {
  const body = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/^[\s\S]*?\nconst lexer/, "");
  assert.equal(body("./url-policy.ts"), body("../../frontend/src/content/url-policy.ts"));
});
