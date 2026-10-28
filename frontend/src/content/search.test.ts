import assert from "node:assert/strict";
import { test } from "node:test";
import { type SearchDoc, type Segment, highlight, prepareIndex, search, snippet } from "./search.ts";

const doc = (docId: string, overrides: Partial<SearchDoc> = {}): SearchDoc => ({
  docId,
  path: `/posts/${docId}/`,
  title: "",
  topic: "Backend",
  tags: [],
  publishedAt: "2026-01-01T00:00:00.000Z",
  text: "",
  ...overrides,
});

const ids = (index: SearchDoc[], q: string) => search(prepareIndex(index), q).map((h) => h.doc.docId);

test("matches Chinese text without word segmentation", () => {
  const index = [doc("a", { text: "我們用樂觀鎖處理併發" }), doc("b", { text: "無關內容" })];
  assert.deepEqual(ids(index, "樂觀鎖"), ["a"]);
});

test("is case-insensitive and needs every term to match", () => {
  const index = [doc("a", { title: "FastAPI 入門", text: "pydantic" }), doc("b", { title: "FastAPI 部署" })];
  assert.deepEqual(ids(index, "fastapi PYDANTIC"), ["a"]);
});

test("title matches rank above tag matches, which rank above body matches", () => {
  const index = [
    doc("body", { text: "next.js" }),
    doc("tag", { tags: ["Next.js"] }),
    doc("title", { title: "Next.js 靜態匯出" }),
  ];
  assert.deepEqual(ids(index, "next.js"), ["title", "tag", "body"]);
});

test("equal scores list newer articles first", () => {
  const index = [doc("old", { text: "x", publishedAt: "2025-01-01T00:00:00.000Z" }), doc("new", { text: "x", publishedAt: "2026-06-01T00:00:00.000Z" })];
  assert.deepEqual(ids(index, "x"), ["new", "old"]);
});

test("an empty query returns nothing", () => {
  assert.deepEqual(search(prepareIndex([doc("a", { text: "x" })]), "   "), []);
});

const prepared = (text: string) => prepareIndex([doc("a", { text })])[0];
const plain = (segments: Segment[]) => segments.map((s) => s.text).join("");
const marks = (segments: Segment[]) => segments.filter((s) => s.mark).map((s) => s.text);

test("highlight marks every term case-insensitively and merges overlapping and adjacent hits", () => {
  assert.deepEqual(highlight("FastAPI and fastapi", ["fastapi"]), [
    { text: "FastAPI", mark: true },
    { text: " and ", mark: false },
    { text: "fastapi", mark: true },
  ]);
  assert.deepEqual(marks(highlight("abcdef", ["abc", "cde", "ef"])), ["abcdef"]);
  assert.deepEqual(marks(highlight("abcd", ["ab", "cd"])), ["abcd"]);
  assert.deepEqual(highlight("none", ["x"]), [{ text: "none", mark: false }]);
});

test("highlight shows the lowercase text when lowercasing changes its length", () => {
  assert.equal(plain(highlight("İstanbul", ["stan"])), "i̇stanbul");
  assert.deepEqual(marks(highlight("İstanbul", ["stan"])), ["stan"]);
  assert.equal(plain(highlight("Istanbul", ["stan"])), "Istanbul");
});

test("a snippet starts 30 units before the first match, is 120 units long, and marks the terms", () => {
  const text = "a".repeat(100) + " needle " + "b".repeat(200);
  const segments = snippet(prepared(text), ["needle"]);
  assert.deepEqual(segments[0], { text: "…", mark: false });
  assert.deepEqual(segments.at(-1), { text: "…", mark: false });
  assert.equal(plain(segments).length, 122);
  assert.equal(plain(segments).indexOf("needle"), 1 + 30);
  assert.deepEqual(marks(segments), ["needle"]);
});

test("a snippet has no ellipsis on a side that is not cut", () => {
  assert.deepEqual(snippet(prepared("short needle text"), ["needle"]).map((s) => s.text), ["short ", "needle", " text"]);
  const tail = snippet(prepared("x".repeat(200) + "needle"), ["needle"]);
  assert.equal(tail[0].text, "…");
  assert.equal(plain(tail).endsWith("needle"), true);
});

test("a snippet keeps original case and marks the earliest hit of any term", () => {
  const segments = snippet(prepared("Intro. Pydantic validates, FastAPI serves."), ["fastapi", "pydantic"]);
  assert.deepEqual(marks(segments), ["Pydantic", "FastAPI"]);
});

test("a snippet falls back to the start of the body when no term hits it", () => {
  const segments = snippet(prepared("c".repeat(300)), ["title"]);
  assert.deepEqual(segments.map((s) => s.mark), [false, false]);
  assert.equal(plain(segments), "c".repeat(120) + "…");
  assert.deepEqual(snippet(prepared(""), ["x"]), []);
});

test("a snippet never cuts a surrogate pair", () => {
  for (const text of ["😀".repeat(40) + "xneedle" + "😀".repeat(100), "y" + "😀".repeat(100), "😀".repeat(40) + "needle" + "😀".repeat(100), "x😀".repeat(100), "😀x".repeat(100), "😀".repeat(100)]) {
    const cut = plain(snippet(prepared(text), ["needle", "x"])).replace(/^…|…$/g, "");
    assert.doesNotMatch(cut, /^[\udc00-\udfff]|[\ud800-\udbff]$/, text.slice(0, 4));
  }
});

test("a snippet is built from the lowercase text when lowercasing changes the length", () => {
  const segments = snippet(prepared("İ needle"), ["needle"]);
  assert.equal(plain(segments), "i̇ needle");
  assert.deepEqual(marks(segments), ["needle"]);
});

test("hits carry the prepared document for snippets", () => {
  const index = prepareIndex([doc("a", { text: "needle" })]);
  assert.strictEqual(search(index, "needle")[0].prepared, index[0]);
});

test("a cut snippet does not start with the punctuation that ended the previous phrase", () => {
  const segments = snippet(prepared("a".repeat(5) + "。 " + "b".repeat(28) + "needle"), ["needle"]);
  assert.deepEqual(segments.map((s) => s.text), ["…", "b".repeat(28), "needle"]);
});

test("trimming leading punctuation never removes the start of a match", () => {
  const segments = snippet(prepared("a".repeat(40) + "。".repeat(40) + "。next"), ["。next"]);
  assert.deepEqual(segments.filter((s) => s.mark).map((s) => s.text), ["。next"]);
});
