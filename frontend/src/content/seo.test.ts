import assert from "node:assert/strict";
import { test } from "node:test";
import type { SiteContent } from "./model.ts";
import { taxonDescription } from "./card.ts";
import { imagePaths, parseSnapshot } from "./parse.ts";
import { published } from "./queries.ts";
import { sitemapEntries } from "./sitemap.ts";
import { summary } from "./summary.ts";

const A = "01K7M4Y7P65BDCF8AHRTQY7ZQA";
const B = "01K7M4Y7P65BDCF8AHRTQY7ZQB";
const C = "01K7M4Y7P65BDCF8AHRTQY7ZQC";
const article = (doc_id: string, published_at: string, tags: { slug: string; name: string }[] = []) => ({
  doc_id,
  version: 1,
  title: "T",
  topic: { slug: "backend", name: "Backend" },
  tags,
  published_at,
  markdown: "m",
});

function content(): SiteContent {
  const files: Record<string, unknown> = {
    [A]: article(A, "2026-01-01T00:00:00Z", [{ slug: "python", name: "Python" }]),
    [B]: article(B, "2026-03-01T00:00:00Z"),
  };
  return parseSnapshot({
    manifest: {
      schema_version: 1,
      release_id: "01K82XH4C5V6B7N8M9P0Q1R2S3",
      created_at: "2026-10-20T00:00:00Z",
      articles: [A, B].map((doc_id) => ({ doc_id, version: 1 })),
      archived_articles: [{ doc_id: C }],
    },
    readArticle: (docId) => files[docId],
    hasImage: () => true,
  });
}

test("sitemap lists published pages and leaves out archived articles", () => {
  const entries = sitemapEntries(content());
  assert.deepEqual(
    entries.map((e) => e.path),
    ["/", "/posts/", "/archive/", "/about/", "/topics/", "/tags/", `/posts/${B}/`, `/posts/${A}/`, "/topics/backend/", "/tags/python/"],
  );
  assert.equal(entries[0]!.lastModified?.toISOString(), "2026-03-01T00:00:00.000Z");
  assert.ok(!entries.some((e) => e.path.includes(C)));
});

test("a topic or tag description counts the articles and lists the newest three titles", () => {
  const [newest] = published(content());
  const titled = (n: number) => Array.from({ length: n }, (_, i) => ({ ...newest!, title: `文${i + 1}` }));
  assert.equal(taxonDescription("Backend 主題", titled(2)), "Backend 主題的 2 篇文章：〈文1〉、〈文2〉。");
  assert.equal(taxonDescription("#Python 標籤", titled(1)), "#Python 標籤的 1 篇文章：〈文1〉。");
  assert.equal(taxonDescription("Backend 主題", titled(5)), "Backend 主題的 5 篇文章：〈文1〉、〈文2〉、〈文3〉。");
});

test("summary is plain text of the opening, without code, images or link syntax", () => {
  const md = "# 標題\n\n![圖](images/x.png)\n\n看 [FastAPI](https://fastapi.tiangolo.com) 的 **說明**。\n\n```py\nsecret = 1\n```\n";
  assert.equal(summary(md), "標題 看 FastAPI 的 說明。");
  assert.equal(summary("字".repeat(200)).length, 120);
  assert.equal(summary("清單：\n\n- 一\n- 二\n1. 三"), "清單： 一 二 三");
  assert.equal(summary("a <b>bold</b> <br/> word"), "a bold word");
  assert.equal(summary("See <https://example.com> or <me@example.com>."), "See https://example.com or me@example.com.");
  const family = "👨‍👩‍👧";
  const cut = summary(family.repeat(200));
  assert.equal(cut, `${family.repeat(119)}…`);
});

test("imagePaths lists uploaded images in document order, skipping code blocks", () => {
  const md = "```md\n![](images/in-code.webp)\n```\n\n![外部](https://example.com/x.png)\n\n![a](images/first.webp) ![b](images/second.webp)";
  assert.deepEqual(imagePaths(md), ["images/first.webp", "images/second.webp"]);
  assert.deepEqual(imagePaths("沒有圖片"), []);
});
