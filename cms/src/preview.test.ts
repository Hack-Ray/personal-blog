import assert from "node:assert/strict";
import { test } from "node:test";
import { loadHighlighter, renderPreview } from "./preview.ts";

test("draft image references load from the API", () => {
  const html = renderPreview("![a](images/abc.png) ![b](https://example.com/b.png)");
  assert.match(html, /src="\/api\/images\/abc\.png"/);
  assert.match(html, /src="https:\/\/example\.com\/b\.png"/);
});

test("an image alone in its paragraph is a captioned figure, as on the site", () => {
  assert.equal(
    renderPreview("![A & B](images/a.webp)"),
    '<figure><img src="/api/images/a.webp" alt="A &amp; B"><figcaption>A &amp; B</figcaption></figure>\n',
  );
});

test("external text links get the site's marker", () => {
  assert.match(renderPreview("[x](https://example.com)"), /class="external"/);
  assert.doesNotMatch(renderPreview("[x](#top)"), /external/);
});

test("code is plain until the highlighter loads, then highlighted like the site", async () => {
  const md = "```ts\nconst x = 1;\n```";
  assert.equal(renderPreview(md), "<pre><code>const x = 1;</code></pre>\n");
  const html = renderPreview(md, await loadHighlighter());
  assert.match(html, /<pre class="shiki/);
  assert.match(html, /--shiki-dark:#/);
  assert.equal(renderPreview("```nope\n<b>\n```", await loadHighlighter()), "<pre><code>&lt;b&gt;</code></pre>\n");
});
