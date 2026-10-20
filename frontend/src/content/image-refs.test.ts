import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { imageRefs } from "./parse.ts";

// Shared with backend/tests/test_image_refs.py so the two parsers agree on what an image reference is.
const cases: { name: string; markdown: string; refs: string[] }[] = JSON.parse(
  readFileSync(new URL("../../test-fixtures/image-refs.json", import.meta.url), "utf8"),
);

for (const { name, markdown, refs } of cases) {
  test(`image refs: ${name}`, () => {
    const ids = new Set(imageRefs(markdown).map((href) => href.slice("images/".length)));
    assert.deepEqual([...ids].sort(), refs);
  });
}
