import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { blockedUrls } from "./url-policy.ts";

const cases: { name: string; markdown: string; blocked: string[] }[] = JSON.parse(
  readFileSync(new URL("../../test-fixtures/url-policy.json", import.meta.url), "utf8"),
);

for (const { name, markdown, blocked } of cases) {
  test(`url policy: ${name}`, () => assert.deepEqual(blockedUrls(markdown), blocked));
}
