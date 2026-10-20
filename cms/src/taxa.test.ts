import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTags, parseTags } from "./taxa.ts";

test("parses slugs with optional display names", () => {
  assert.deepEqual(parseTags("fastapi:FastAPI, python , github-pages:GitHub Pages,"), {
    tags: [
      { slug: "fastapi", name: "FastAPI" },
      { slug: "python", name: "python" },
      { slug: "github-pages", name: "GitHub Pages" },
    ],
    invalid: [],
  });
});

test("reports items whose slug is not lowercase kebab-case", () => {
  assert.deepEqual(parseTags("Python, 後端:Backend").invalid, ["Python", "後端:Backend"]);
});

test("format and parse round-trip", () => {
  const tags = [
    { slug: "fastapi", name: "FastAPI" },
    { slug: "python", name: "python" },
  ];
  assert.deepEqual(parseTags(formatTags(tags)).tags, tags);
});
