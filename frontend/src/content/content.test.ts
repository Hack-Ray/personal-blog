import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSiteContent } from "./load.ts";
import { renderMarkdown } from "./markdown.ts";
import type { DocId, Slug } from "./model.ts";
import { ContentError, parseSnapshot, type Snapshot } from "./parse.ts";
import { findArticle, inTopic, published, tags, topics, withTag } from "./queries.ts";

const A = "01K7M4Y7P65BDCF8AHRTQY7ZQA";
const B = "01K7M4Y7P65BDCF8AHRTQY7ZQB";
const C = "01K7M4Y7P65BDCF8AHRTQY7ZQC";

const articleFile = (docId: string, overrides: Record<string, unknown> = {}) => ({
  doc_id: docId,
  version: 1,
  title: "Title",
  topic: { slug: "backend", name: "Backend" },
  tags: [],
  published_at: "2026-10-01T00:00:00Z",
  markdown: "body",
  ...overrides,
});

function snapshot({
  manifest = {},
  files = {},
  images = [],
}: {
  manifest?: Record<string, unknown>;
  files?: Record<string, unknown>;
  images?: string[];
}): Snapshot {
  return {
    manifest: {
      schema_version: 1,
      release_id: "01K82XH4C5V6B7N8M9P0Q1R2S3",
      created_at: "2026-10-20T00:00:00Z",
      articles: Object.keys(files).map((doc_id) => ({ doc_id, version: 1 })),
      archived_articles: [],
      ...manifest,
    },
    readArticle: (docId) => {
      if (!(docId in files)) throw new ContentError(`articles/${docId}.json: file not found`);
      return files[docId];
    },
    hasImage: (name) => images.includes(name),
  };
}

test("the committed sample snapshot loads", () => {
  const content = loadSiteContent();
  assert.equal(published(content).length, 3);
  assert.equal(content.articles.filter((a) => a.state === "archived").length, 1);
});

test("an archived article carries only its docId", () => {
  const content = parseSnapshot(snapshot({ manifest: { archived_articles: [{ doc_id: B }] } }));
  assert.deepEqual(content.articles, [{ state: "archived", docId: B }]);
});

test("rejects an unknown schema version", () => {
  assert.throws(() => parseSnapshot(snapshot({ manifest: { schema_version: 2 } })), /schema_version: expected 1, got 2/);
});

test("rejects docIds that are not uppercase ULIDs", () => {
  for (const docId of [A.toLowerCase(), A.slice(1), `${A.slice(0, -1)}I`, `8${A.slice(1)}`]) {
    assert.throws(() => parseSnapshot(snapshot({ files: { [docId]: articleFile(docId) } })), /ULID/);
  }
});

test("rejects a manifest entry whose article file is missing", () => {
  assert.throws(
    () => parseSnapshot(snapshot({ manifest: { articles: [{ doc_id: A, version: 1 }] } })),
    /articles\/01K7M4Y7P65BDCF8AHRTQY7ZQA\.json: file not found/,
  );
});

test("rejects an article file from a different release version", () => {
  assert.throws(
    () => parseSnapshot(snapshot({ files: { [A]: articleFile(A, { version: 2 }) } })),
    /manifest expects 1, file has 2/,
  );
});

test("rejects an article file whose doc_id does not match its name", () => {
  assert.throws(() => parseSnapshot(snapshot({ files: { [A]: articleFile(B) } })), /expected 01K7M4Y7P65BDCF8AHRTQY7ZQA, got 01K7M4Y7P65BDCF8AHRTQY7ZQB/);
});

test("rejects a docId listed as both published and archived", () => {
  assert.throws(
    () => parseSnapshot(snapshot({ files: { [A]: articleFile(A) }, manifest: { archived_articles: [{ doc_id: A }] } })),
    /listed more than once/,
  );
});

test("rejects an article that references an image missing from the snapshot", () => {
  const files = { [A]: articleFile(A, { markdown: "![x](images/abc.webp)" }) };
  assert.throws(() => parseSnapshot(snapshot({ files })), /missing image images\/abc\.webp/);
  assert.equal(parseSnapshot(snapshot({ files, images: ["abc.webp"] })).articles.length, 1);
});

test("rejects an unparseable publish date", () => {
  assert.throws(() => parseSnapshot(snapshot({ files: { [A]: articleFile(A, { published_at: "yesterday" }) } })), /ISO 8601/);
});

test("published lists newest first and leaves out archived articles", () => {
  const content = parseSnapshot(
    snapshot({
      files: {
        [A]: articleFile(A, { published_at: "2026-01-01T00:00:00Z" }),
        [C]: articleFile(C, { published_at: "2026-03-01T00:00:00Z" }),
      },
      manifest: { archived_articles: [{ doc_id: B }] },
    }),
  );
  assert.deepEqual(published(content).map((a) => a.docId), [C, A]);
  assert.equal(findArticle(content, B as DocId)?.state, "archived");
  assert.equal(findArticle(content, "01K7M4Y7P65BDCF8AHRTQY7ZQD" as DocId), undefined);
});

test("topics and tags come only from published articles", () => {
  const python = { slug: "python", name: "Python" };
  const content = parseSnapshot(
    snapshot({
      files: {
        [A]: articleFile(A, { tags: [python] }),
        [C]: articleFile(C, { topic: { slug: "frontend", name: "Frontend" }, tags: [python] }),
      },
    }),
  );
  assert.deepEqual(topics(content).map((t) => t.slug), ["backend", "frontend"]);
  assert.deepEqual(tags(content).map((t) => t.slug), ["python"]);
  assert.equal(inTopic(content, "frontend" as Slug).length, 1);
  assert.equal(withTag(content, "python" as Slug).length, 2);
});

test("snapshot image references resolve under the basePath", () => {
  const html = renderMarkdown("![a](images/abc.svg) ![b](https://example.com/x.png)", "/personal-blog");
  assert.match(html, /src="\/personal-blog\/images\/abc\.svg"/);
  assert.match(html, /src="https:\/\/example\.com\/x\.png"/);
});
