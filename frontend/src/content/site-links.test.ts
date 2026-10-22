import assert from "node:assert/strict";
import { test } from "node:test";
import { legacySiteUrls, migrateSiteLink } from "./site-links.ts";

test("old site roots migrate paths, queries and anchors to the current basePath", () => {
  const roots = legacySiteUrls(" https://old.example/blog/, https://older.example ");
  assert.equal(migrateSiteLink("https://old.example/blog/posts/A/?x=1#part", "/new", roots), "/new/posts/A/?x=1#part");
  assert.equal(migrateSiteLink("https://old.example/blog#part", "", roots), "/#part");
  assert.equal(migrateSiteLink("https://older.example", "/new", roots), "/new/");
});

test("migration does not rewrite sibling sites or a host with a matching prefix", () => {
  const roots = legacySiteUrls("https://old.example/blog");
  for (const url of ["https://old.example/blogger/", "https://old.example/other/", "https://old.example.evil/blog/", "/posts/A/"]) {
    assert.equal(migrateSiteLink(url, "", roots), url);
  }
});

test("legacy URL configuration rejects unsafe or ambiguous roots", () => {
  for (const url of ["javascript:alert(1)", "https://user:secret@old.example", "https://old.example?x=1", "https://old.example/#part", "old.example"]) {
    assert.throws(() => legacySiteUrls(url));
  }
  assert.deepEqual(legacySiteUrls(""), []);
});
