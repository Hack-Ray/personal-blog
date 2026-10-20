import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { DocId, Slug } from "./model.ts";
import { ContentError, parseSiteContent } from "./parse.ts";
import { findArticle, inTopic, published, tags, topics, withTag } from "./queries.ts";

const article = (overrides: Record<string, unknown> = {}) => ({
  state: "published",
  docId: "01K7M4Y7P65BDCF8AHRTQY7ZQF",
  title: "Title",
  topic: { slug: "backend", name: "Backend" },
  tags: [],
  publishedAt: "2026-10-01T00:00:00Z",
  markdown: "body",
  ...overrides,
});

test("the committed fixture parses", () => {
  const raw = JSON.parse(readFileSync(new URL("../../content/site.json", import.meta.url), "utf8"));
  assert.equal(parseSiteContent(raw).articles.length, 4);
});

test("an archived article keeps only its docId", () => {
  const content = parseSiteContent({ articles: [{ state: "archived", docId: "01K6ZT3H5J7K9M1N3P5Q7R9S1T", title: "x" }] });
  assert.deepEqual(content.articles, [{ state: "archived", docId: "01K6ZT3H5J7K9M1N3P5Q7R9S1T" }]);
});

test("rejects states that must never reach the public build", () => {
  for (const state of ["draft", "pending_deletion", "deleted"]) {
    assert.throws(() => parseSiteContent({ articles: [article({ state })] }), ContentError);
  }
});

test("rejects docIds that are not uppercase ULIDs", () => {
  for (const docId of ["01k7m4y7p65bdcf8ahrtqy7zqf", "01K7M4Y7P65BDCF8AHRTQY7ZQ", "01K7M4Y7P65BDCF8AHRTQY7ZQI", "81K7M4Y7P65BDCF8AHRTQY7ZQF"]) {
    assert.throws(() => parseSiteContent({ articles: [article({ docId })] }), /ULID/);
  }
});

test("rejects duplicate docIds", () => {
  assert.throws(() => parseSiteContent({ articles: [article(), article()] }), /duplicate docId/);
});

test("rejects an unparseable publish date", () => {
  assert.throws(() => parseSiteContent({ articles: [article({ publishedAt: "yesterday" })] }), /ISO 8601/);
});

test("published lists newest first and leaves out archived articles", () => {
  const content = parseSiteContent({
    articles: [
      article({ docId: "01K7M4Y7P65BDCF8AHRTQY7ZQA", publishedAt: "2026-01-01T00:00:00Z" }),
      { state: "archived", docId: "01K7M4Y7P65BDCF8AHRTQY7ZQB" },
      article({ docId: "01K7M4Y7P65BDCF8AHRTQY7ZQC", publishedAt: "2026-03-01T00:00:00Z" }),
    ],
  });
  assert.deepEqual(published(content).map((a) => a.docId), ["01K7M4Y7P65BDCF8AHRTQY7ZQC", "01K7M4Y7P65BDCF8AHRTQY7ZQA"]);
  assert.equal(findArticle(content, "01K7M4Y7P65BDCF8AHRTQY7ZQB" as DocId)?.state, "archived");
  assert.equal(findArticle(content, "01K7M4Y7P65BDCF8AHRTQY7ZQD" as DocId), undefined);
});

test("topics and tags come only from published articles", () => {
  const content = parseSiteContent({
    articles: [
      article({ docId: "01K7M4Y7P65BDCF8AHRTQY7ZQA", tags: [{ slug: "python", name: "Python" }] }),
      article({ docId: "01K7M4Y7P65BDCF8AHRTQY7ZQC", topic: { slug: "frontend", name: "Frontend" }, tags: [{ slug: "python", name: "Python" }] }),
    ],
  });
  assert.deepEqual(topics(content).map((t) => t.slug), ["backend", "frontend"]);
  assert.deepEqual(tags(content).map((t) => t.slug), ["python"]);
  assert.equal(inTopic(content, "frontend" as Slug).length, 1);
  assert.equal(withTag(content, "python" as Slug).length, 2);
});
