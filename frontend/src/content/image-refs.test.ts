import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { imagePaths } from "./parse.ts";

const cases: { name: string; markdown: string; refs: string[] }[] = JSON.parse(
  readFileSync(new URL("../../test-fixtures/image-refs.json", import.meta.url), "utf8"),
);

for (const { name, markdown, refs } of cases) {
  test(`image refs: ${name}`, () => {
    const ids = new Set(imagePaths(markdown).map((href) => href.slice("images/".length)));
    assert.deepEqual([...ids].sort(), refs);
  });
}
