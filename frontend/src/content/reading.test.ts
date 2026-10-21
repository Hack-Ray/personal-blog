import assert from "node:assert/strict";
import { test } from "node:test";
import { readingMinutes } from "./reading.ts";

test("pure CJK counts 400 characters per minute, rounded up", () => {
  assert.equal(readingMinutes("字".repeat(400)), 1);
  assert.equal(readingMinutes("字".repeat(401)), 2);
  assert.equal(readingMinutes("字".repeat(1200)), 3);
});

test("pure English counts 200 words per minute", () => {
  assert.equal(readingMinutes("word ".repeat(200)), 1);
  assert.equal(readingMinutes("word ".repeat(201)), 2);
});

test("mixed text adds both rates", () => {
  assert.equal(readingMinutes(`${"字".repeat(400)} ${"word ".repeat(200)}`), 2);
  assert.equal(readingMinutes(`${"字".repeat(200)} ${"word ".repeat(100)}`), 1);
});

test("code blocks and images are not read; empty text still takes a minute", () => {
  assert.equal(readingMinutes("```py\n" + "x ".repeat(5000) + "\n```\n\n![圖](images/a.png)"), 1);
  assert.equal(readingMinutes(""), 1);
});
