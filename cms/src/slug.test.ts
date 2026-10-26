import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./api.ts";
import { onSlugBlur, publicPath, slugProblem, slugSaveFailed } from "./slug.ts";

test("a slug is lowercase kebab-case of up to 80 characters and not reserved", () => {
  for (const ok of ["hello", "hello-world-2", "a".repeat(80)]) assert.equal(slugProblem(ok), undefined, ok);
  for (const bad of ["Hello", "hello_world", "-hello", "hello-", "a--b", "中文", "a".repeat(81), "page"]) assert.ok(slugProblem(bad), bad);
});

test("leaving the field saves only a changed, valid slug and an empty field clears it", () => {
  assert.deepEqual(onSlugBlur("hello", "hello"), { kind: "none" });
  assert.deepEqual(onSlugBlur("  ", null), { kind: "none" });
  assert.deepEqual(onSlugBlur(" hello ", null), { kind: "save", slug: "hello" });
  assert.deepEqual(onSlugBlur("", "hello"), { kind: "save", slug: null });
  assert.equal(onSlugBlur("Hello", null).kind, "invalid");
  assert.equal(onSlugBlur("page", "hello").kind, "invalid");
});

test("a slug another article uses offers the server's suggestion", () => {
  assert.deepEqual(slugSaveFailed(new ApiError(409, { detail: "taken", suggestion: "hello-2" })), { kind: "taken", suggestion: "hello-2" });
  assert.deepEqual(slugSaveFailed(new ApiError(422, { detail: "page is reserved" })), { kind: "invalid", message: "page is reserved" });
  assert.equal(slugSaveFailed(new ApiError(409, { detail: "cannot edit an article that is pending_deletion" })).kind, "error");
  assert.equal(slugSaveFailed(new TypeError("Failed to fetch")).kind, "error");
});

test("the public path falls back to the doc_id", () => {
  assert.equal(publicPath("01K7M4Y7P65BDCF8AHRTQY7ZQA", null), "/posts/01K7M4Y7P65BDCF8AHRTQY7ZQA/");
  assert.equal(publicPath("01K7M4Y7P65BDCF8AHRTQY7ZQA", "hello"), "/posts/hello/");
});
