import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { imageIds } from "./cover.ts";

test("lists each uploaded image once, in order", () => {
  assert.deepEqual(imageIds("![](images/b.webp) ![](https://x.test/a.png) ![](images/a.webp) ![](images/b.webp)"), ["b.webp", "a.webp"]);
});

test("agrees with the shared image reference fixture", () => {
  const cases: { name: string; markdown: string; refs: string[] }[] = JSON.parse(
    readFileSync(new URL("../../frontend/test-fixtures/image-refs.json", import.meta.url), "utf8"),
  );
  for (const { name, markdown, refs } of cases) assert.deepEqual(imageIds(markdown).sort(), refs, name);
});
