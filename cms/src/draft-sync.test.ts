import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, type DraftApi, type DraftContent } from "./api.ts";
import { DraftSync } from "./draft-sync.ts";

const content = (markdown: string): DraftContent => ({
  title: "T",
  topic: { slug: "backend", name: "Backend" },
  tags: [],
  markdown,
});

/** Mimics the backend's revision check; each call waits until released. */
function fakeServer() {
  let revision = 1;
  let stored = content("initial");
  const published: string[] = [];
  const calls: string[] = [];
  const gates: (() => void)[] = [];
  const gate = () => new Promise<void>((r) => gates.push(r));

  const check = (base: number) => {
    if (base !== revision) throw new ApiError(409, { detail: "stale", current_revision: revision });
  };
  const api: DraftApi = {
    async save(_docId, base, c) {
      calls.push(`save@${base}:${c.markdown}`);
      await gate();
      check(base);
      stored = c;
      revision += 1;
      return { ...c, doc_id: "D", state: "draft", revision, updated_at: "" };
    },
    async publish(_docId, base, c) {
      calls.push(`publish@${base}:${c.markdown}`);
      await gate();
      check(base);
      stored = c;
      revision += 1;
      published.push(c.markdown);
      return { doc_id: "D", version: published.length, revision, published_at: "" };
    },
  };
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    api,
    calls,
    published,
    stored: () => stored.markdown,
    bump: () => void (revision += 1),
    async releaseAll() {
      for (let i = 0; i < 20; i++) {
        await tick();
        gates.splice(0).forEach((open) => open());
      }
    },
  };
}

const started = () => new Promise((r) => setImmediate(r));

const newSync = (server: ReturnType<typeof fakeServer>) =>
  new DraftSync(server.api, "D", { revision: 1, content: content("initial") }, () => {}, 0);

test("edits are saved with the revision the previous save returned", async () => {
  const server = fakeServer();
  const sync = newSync(server);
  sync.edit(content("a"));
  const first = sync.flush();
  await started();
  sync.edit(content("ab"));
  const second = sync.flush();
  await server.releaseAll();
  await Promise.all([first, second]);
  assert.deepEqual(server.calls, ["save@1:a", "save@2:ab"]);
  assert.equal(server.stored(), "ab");
  assert.equal(sync.status.kind, "saved");
});

test("publish waits for the in-flight save and sends what the author sees", async () => {
  const server = fakeServer();
  const sync = newSync(server);
  sync.edit(content("typed before publish"));
  const saving = sync.flush();
  await started();
  sync.edit(content("what I see"));
  const publishing = sync.publish();
  await server.releaseAll();
  await saving;
  const result = await publishing;
  assert.deepEqual(server.calls, ["save@1:typed before publish", "publish@2:what I see"]);
  assert.deepEqual(server.published, ["what I see"]);
  assert.equal(result?.version, 1);
  assert.equal(sync.status.kind, "saved");
});

test("a save rejected as stale stops autosave and reports the conflict", async () => {
  const server = fakeServer();
  const sync = newSync(server);
  server.bump();
  sync.edit(content("edited elsewhere"));
  const saving = sync.flush();
  await server.releaseAll();
  await saving;
  assert.deepEqual(sync.status, { kind: "conflict", currentRevision: 2 });
  sync.edit(content("more"));
  await sync.flush();
  assert.equal(server.calls.length, 1);
});

test("edits made while a save is in flight are saved afterwards", async () => {
  const server = fakeServer();
  const sync = newSync(server);
  sync.edit(content("one"));
  const saving = sync.flush();
  await started();
  sync.edit(content("two"));
  await server.releaseAll();
  await saving;
  const followUp = sync.flush();
  await server.releaseAll();
  await followUp;
  assert.equal(server.stored(), "two");
  assert.equal(sync.status.kind, "saved");
});
