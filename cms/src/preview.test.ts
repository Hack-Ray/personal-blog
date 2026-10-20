import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPreview } from "./preview.ts";

test("draft image references load from the API", () => {
  const html = renderPreview("![a](images/abc.png) ![b](https://example.com/b.png)");
  assert.match(html, /src="\/api\/images\/abc\.png"/);
  assert.match(html, /src="https:\/\/example\.com\/b\.png"/);
});
