import assert from "node:assert/strict";
import { test } from "node:test";
import { type SearchDoc, prepareIndex, search } from "./search.ts";

const doc = (docId: string, overrides: Partial<SearchDoc> = {}): SearchDoc => ({
  docId,
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
