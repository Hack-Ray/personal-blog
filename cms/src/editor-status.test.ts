import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftContent } from "./api.ts";
import { statusLabel, unsavedReason } from "./editor-status.ts";

const saved: DraftContent = {
  title: "T",
  topic: { slug: "backend", name: "Backend" },
  tags: [{ slug: "go", name: "Go" }],
  markdown: "body",
};

const badSlug: DraftContent = { ...saved, topic: { slug: "Back End", name: "Backend" }, markdown: "body, edited" };
const blankName: DraftContent = { ...saved, topic: { slug: "backend", name: "  " }, markdown: "body, edited" };

test("edits held back by an invalid topic show as unsaved with the reason", () => {
  for (const content of [badSlug, blankName]) {
    assert.deepEqual(statusLabel({ kind: "saved" }, content, saved), {
      kind: "unsaved",
      text: "未儲存：Topic 不合法",
    });
  }
});

test("an invalid topic with nothing new to save still shows saved", () => {
  const loaded = { ...saved, topic: { slug: "Back End", name: "Backend" } };
  assert.deepEqual(statusLabel({ kind: "saved" }, { ...loaded, tags: [...loaded.tags] }, loaded), {
    kind: "saved",
    text: "已儲存",
  });
});

test("a valid topic shows the sync status", () => {
  const edited = { ...saved, markdown: "body, edited" };
  assert.deepEqual(statusLabel({ kind: "saved" }, saved, saved), { kind: "saved", text: "已儲存" });
  assert.deepEqual(statusLabel({ kind: "dirty" }, edited, saved), { kind: "dirty", text: "尚未儲存" });
  assert.deepEqual(statusLabel({ kind: "error", message: "offline" }, edited, saved), {
    kind: "error",
    text: "儲存失敗：offline",
  });
});

test("a conflict outranks an invalid topic", () => {
  assert.deepEqual(statusLabel({ kind: "conflict", currentRevision: 3 }, badSlug, saved), {
    kind: "conflict",
    text: "草稿已在其他地方被修改",
  });
});

test("only content with a valid topic can be saved", () => {
  assert.equal(unsavedReason(saved), undefined);
  assert.equal(unsavedReason(badSlug), "Topic 不合法");
  assert.equal(unsavedReason(blankName), "Topic 不合法");
});
