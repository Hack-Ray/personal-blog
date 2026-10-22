import assert from "node:assert/strict";
import { test } from "node:test";
import { headings, tocHeadings } from "./headings.ts";
import { renderMarkdown } from "./markdown.ts";

test("slugs keep CJK, lowercase ASCII, join words with hyphens and drop punctuation", () => {
  const md = "## 為什麼自建 CMS？\n\n### Hello, World!\n\n## C++ & Rust";
  assert.deepEqual(
    headings(md).map((h) => [h.depth, h.text, h.id]),
    [
      [2, "為什麼自建 CMS？", "為什麼自建-cms"],
      [3, "Hello, World!", "hello-world"],
      [2, "C++ & Rust", "c-rust"],
    ],
  );
});

test("repeated headings get -2, -3 and only h2 and h3 count", () => {
  const md = "# Title\n\n## 小節\n\n#### Deep\n\n## 小節\n\n### 小節\n\n## 小節-2";
  assert.deepEqual(headings(md).map((h) => h.id), ["小節", "小節-2", "小節-3", "小節-2-2"]);
});

test("inline markup is reduced to its text and headings in code blocks are ignored", () => {
  const md = "## `npm` **install**\n\n```md\n## not a heading\n```";
  assert.deepEqual(headings(md).map((h) => [h.text, h.id]), [["npm install", "npm-install"]]);
});

test("rendered h2 and h3 carry the ids of headings(), h1 does not", () => {
  const md = "# Top\n\n## 小節\n\n### 小節\n\n## Other *one*";
  const html = renderMarkdown(md, "/base");
  assert.match(html, /<h1>Top<\/h1>/);
  for (const h of headings(md)) assert.ok(html.includes(`id="${h.id}"`), h.id);
  assert.match(html, /<h2 id="other-one">Other <em>one<\/em><\/h2>/);
});

test("a table of contents needs three h2 or h3 headings", () => {
  assert.deepEqual(tocHeadings("## a\n\n### b\n\n#### c"), []);
  assert.deepEqual(tocHeadings("## a\n\n### b\n\n## c").map((h) => h.id), ["a", "b", "c"]);
});

test("headings in quotes and lists get ids in render order but stay out of the table of contents", () => {
  const md = "> ## Setup\n\n## Setup\n\n- ## Setup\n\n## TOC\n\n## Related title\n\n## End";
  const all = headings(md);
  assert.deepEqual(all.map((h) => [h.id, h.nested]), [
    ["setup", true],
    ["setup-2", false],
    ["setup-3", true],
    ["toc-2", false],
    ["related-title-2", false],
    ["end", false],
  ]);
  const html = renderMarkdown(md, "/base");
  assert.deepEqual([...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]), all.map((h) => h.id));
  assert.deepEqual(tocHeadings(md).map((h) => h.id), ["setup-2", "toc-2", "related-title-2", "end"]);
});
