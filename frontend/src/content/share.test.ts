import assert from "node:assert/strict";
import { test } from "node:test";
import { shareLinks } from "./share.ts";

test("every share link carries the post URL, encoded", () => {
  const url = "https://example.com/personal-blog/posts/a-b/?x=1&y=2";
  for (const { name, href } of shareLinks(url, "標題")) {
    const params = new URL(href).searchParams;
    assert.ok([...params.values()].includes(url), name);
  }
});

test("X and Threads also carry the title", () => {
  const byName = Object.fromEntries(shareLinks("https://example.com/p/", "A & B #1").map((l) => [l.name, l.href]));
  for (const name of ["X", "Threads"]) assert.equal(new URL(byName[name]).searchParams.get("text"), "A & B #1");
});
