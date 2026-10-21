import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_METADATA, type DraftContent } from "./api.ts";
import { prePublishWarnings } from "./publish-checks.ts";

const content = (overrides: Partial<DraftContent> = {}): DraftContent => ({
  title: "Title",
  topic: { slug: "backend", name: "Backend" },
  tags: [{ slug: "go", name: "Go" }],
  markdown: "![圖](images/a.webp) [link](https://example.com)",
  ...EMPTY_METADATA,
  ...overrides,
});

test("a tidy article has no warnings", () => {
  assert.deepEqual(prePublishWarnings(content()), []);
});

test("warns about missing tags, alt text, long titles, http links, TODOs and a stale cover", () => {
  const warnings = prePublishWarnings(
    content({
      tags: [],
      title: "字".repeat(61),
      markdown: "![](images/a.webp) ![ ](images/b.webp) [x](http://example.com) TODO: finish",
      cover: "gone.webp",
    }),
  );
  assert.deepEqual(warnings, [
    "沒有任何 Tag",
    "2 張圖片沒有替代文字（![這裡](…)），圖片也就沒有圖說",
    "標題超過 60 字，分享預覽可能被截斷",
    "1 個連結或圖片使用不安全的 http://",
    "內文還有 TODO",
    "封面圖已不在文章中，發布會失敗",
  ]);
});

test("a 60-character title and TODO inside a word are fine", () => {
  assert.deepEqual(prePublishWarnings(content({ title: "字".repeat(60), markdown: "TODOS ![a](images/a.webp)" })), []);
});
