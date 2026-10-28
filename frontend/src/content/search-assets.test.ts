import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { article, content } from "../../test-fixtures/search.ts";
import type { DocId, Slug } from "./model.ts";
import { buildSearchAssets } from "./search-assets.ts";
import { buildIndex, prepareIndex, search, type SearchDoc } from "./search.ts";

function legacy(index: SearchDoc[], query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return index.flatMap((doc) => {
    const scores = terms.map((term) =>
      (doc.title.toLowerCase().includes(term) ? 10 : 0) +
      ([doc.topic, ...doc.tags].join(" ").toLowerCase().includes(term) ? 5 : 0) +
      (doc.text.toLowerCase().includes(term) ? 1 : 0));
    return scores.length && scores.every(Boolean) ? [{ docId: doc.docId, score: scores.reduce((a, b) => a + b, 0), date: doc.publishedAt }] : [];
  }).sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).map(({ docId, score }) => ({ docId, score }));
}

test("prepared matching preserves legacy scores, AND substrings, repeated terms, Unicode and stable ties", () => {
  const index = buildIndex(content(
    article("first", 2025, { title: "FastAPI 樂觀鎖", markdown: "PYDANTIC ΟΣ İ backend", excerpt: "FastAPI" }),
    article("second", 2025, { title: "FastAPI 樂觀鎖", markdown: "PYDANTIC ΟΣ İ backend", excerpt: "FastAPI" }),
    article("newer", 2026, { title: "FastAPI", markdown: "fastapi backend" }),
  ));
  for (const query of ["FastAPI", "api api", "樂觀鎖", "fastapi pydantic", "BACKEND", "ος", "i\u0307", "missing", "", "  "]) {
    assert.deepEqual(search(prepareIndex(index), query).map(({ doc, score }) => ({ docId: doc.docId, score })), legacy(index, query), query);
  }
});

test("the legacy 5000 UTF-16 budget covers excerpt and stripped body together", () => {
  const index = buildIndex(content(
    article("budget", 2026, { excerpt: "a".repeat(4997), markdown: "XY forbidden" }),
    article("code", 2026, { markdown: "visible `inline`\n```ts\nfencedSecret\n```\nend" }),
    { state: "archived", docId: "archived" as DocId },
  ));
  assert.equal(index[0].text, "a".repeat(4997) + " XY");
  assert.deepEqual(search(prepareIndex(index), "forbidden"), []);
  assert.deepEqual(search(prepareIndex(index), "fencedSecret"), []);
  assert.equal(search(prepareIndex(index), "inline")[0].doc.docId, "code");
  assert.equal(index.length, 2);
});

test("the searchable budget counts UTF-16 units before lowercase expansion", () => {
  const index = buildIndex(content(article("units", 2026, { excerpt: "a".repeat(4998), markdown: "😀 tail" })));
  assert.equal(index[0].text.length, 5000);
  assert.equal(index[0].text.charCodeAt(4999), 0xd83d);
  const expanded = buildIndex(content(article("expanded", 2026, { markdown: "İ".repeat(5001) })));
  assert.equal(expanded[0].text.length, 5000);
  assert.equal(prepareIndex(expanded)[0].textKey.length, 10000);
});

test("assets use ordered Taipei years, stable hashes and metadata text that prefixes the chunk text", () => {
  const fixture = content(
    article("old", 2024, { markdown: "body" }),
    article("sigma", 2026, { markdown: "x".repeat(158) + "ΟΣΑ" }),
    article("taipei", 2025, { publishedAt: new Date("2026-01-01T00:30:00+08:00"), markdown: "İ".repeat(100) }),
  );
  const assets = buildSearchAssets(fixture);
  assert.deepEqual(assets, buildSearchAssets(fixture));
  const metadata = JSON.parse(assets.metadataJson);
  assert.deepEqual(metadata.years.map((y: { year: number }) => y.year), [2026, 2024]);
  assert.ok(JSON.parse(assets.chunks.get(metadata.years[0].asset)!).docs.some((d: { docId: string }) => d.docId === "taipei"));
  assert.equal(metadata.version, 2);
  assert.equal(metadata.docs[0].text, "x".repeat(158) + "ΟΣ");
  for (const [asset, json] of assets.chunks) {
    const chunk = JSON.parse(json);
    assert.equal(chunk.version, 2);
    assert.equal(asset, `${chunk.year}-${createHash("sha256").update(json).digest("hex")}`);
    for (const doc of chunk.docs) {
      const prefix = metadata.docs.find((d: { docId: string }) => d.docId === doc.docId).text;
      assert.equal(prefix, doc.text.slice(0, 160));
      assert.ok(doc.text.startsWith(prefix));
    }
  }
});

test("search metadata carries each article's path, so the browser links to its slug URL", () => {
  const metadata = JSON.parse(buildSearchAssets(content(article("plain", 2026), article("slugged", 2025, { slug: "hello" as Slug }))).metadataJson);
  assert.deepEqual(metadata.docs.map((d: { path: string }) => d.path), ["/posts/plain/", "/posts/hello/"]);
});

test("empty content exports no advertised placeholder or body asset", () => {
  const assets = buildSearchAssets(content());
  assert.deepEqual(JSON.parse(assets.metadataJson).years, []);
  assert.deepEqual(JSON.parse(assets.metadataJson).docs, []);
  assert.equal(assets.chunks.size, 0);
});

test("the body keeps each phrase once with its original case and punctuation, and still matches", () => {
  const [doc] = buildIndex(content(article("repeat", 2026, { markdown: "樂觀鎖處理併發。樂觀鎖處理併發，Next.js 部署。\n\n樂觀鎖處理併發" })));
  assert.equal(doc.text, "樂觀鎖處理併發。Next.js 部署。");
  for (const query of ["處理併發", "next.js", "部署", "樂觀鎖 部署", "併發。next.js"]) assert.equal(search(prepareIndex([doc]), query).length, 1, query);
  assert.deepEqual(search(prepareIndex([doc]), "併發，next"), []);
});

test("whitespace runs in the body collapse to one space and a leading separator is dropped", () => {
  const [doc] = buildIndex(content(article("space", 2026, { excerpt: "", markdown: "First line\n\n  second   line, First line" })));
  assert.equal(doc.text, "First line second line,");
});
