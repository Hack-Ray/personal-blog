import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, EMPTY_METADATA, type DraftApi, type DraftContent } from "./api.ts";
import { DraftSync } from "./draft-sync.ts";

const content = (markdown: string): DraftContent => ({
  title: "T",
  topic: { slug: "backend", name: "Backend" },
  tags: [],
  markdown,
  ...EMPTY_METADATA,
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
  let loseNextAnswer = false;
  const api: DraftApi = {
    async draft() {
      calls.push("draft");
      return { ...stored, doc_id: "D", slug: null, state: "draft", revision, updated_at: "" };
    },
    async save(_docId, base, c) {
      calls.push(`save@${base}:${c.markdown}`);
      await gate();
      check(base);
      stored = c;
      revision += 1;
      if (loseNextAnswer) {
        loseNextAnswer = false;
        throw new TypeError("Failed to fetch");
      }
      return { ...c, doc_id: "D", slug: null, state: "draft", revision, updated_at: "" };
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
    async restoreSnapshot(_docId, base, snapshotId) {
      calls.push(`restore@${base}:${snapshotId}`);
      await gate();
      check(base);
      stored = { ...stored, markdown: `snapshot ${snapshotId}` };
      revision += 1;
      return { ...stored, doc_id: "D", slug: null, state: "draft", revision, updated_at: "" };
    },
  };
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    api,
    calls,
    published,
    stored: () => stored.markdown,
    bump: () => void (revision += 1),
    /** Another tab's save. */
    overwrite: (c: DraftContent) => {
      stored = c;
      revision += 1;
    },
    loseNextAnswer: () => void (loseNextAnswer = true),
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

test("a save stored by the server whose answer was lost is no conflict", async () => {
  const server = fakeServer();
  const sync = new DraftSync(server.api, "D", { revision: 1, content: content("initial") }, () => {}, 60_000, 60_000);
  server.loseNextAnswer();
  sync.edit(content("stored, answer lost"));
  let saving = sync.flush();
  await server.releaseAll();
  await saving;
  assert.equal(sync.status.kind, "error");
  sync.edit(content("typed afterwards"));
  saving = sync.flush();
  await server.releaseAll();
  await saving;
  // The save after the recovery runs on a timer.
  for (let i = 0; i < 500 && !server.calls.includes("save@2:typed afterwards"); i++) await new Promise((r) => setTimeout(r, 1));
  await server.releaseAll();
  await sync.close();
  assert.deepEqual(server.calls, ["save@1:stored, answer lost", "save@1:typed afterwards", "draft", "save@2:typed afterwards"]);
  assert.equal(server.stored(), "typed afterwards");
  assert.equal(sync.status.kind, "saved");
});

test("a lost answer is a conflict when the server then holds another series", async () => {
  const server = fakeServer();
  const sync = new DraftSync(server.api, "D", { revision: 1, content: content("initial") }, () => {}, 60_000, 60_000);
  server.loseNextAnswer();
  sync.edit({ ...content("same text"), series: { slug: "s", name: "S" } });
  await Promise.all([sync.flush(), server.releaseAll()]);
  server.overwrite(content("same text"));
  sync.edit(content("typed afterwards"));
  await Promise.all([sync.flush(), server.releaseAll()]);
  assert.deepEqual(sync.status, { kind: "conflict", currentRevision: 3 });
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

test("restoring a snapshot first saves pending edits, then uses the new revision", async () => {
  const server = fakeServer();
  const sync = newSync(server);
  sync.edit(content("unsaved"));
  const restoring = sync.restoreSnapshot(7);
  await server.releaseAll();
  const draft = await restoring;
  assert.deepEqual(server.calls, ["save@1:unsaved", "restore@2:7"]);
  assert.equal(draft?.markdown, "snapshot 7");
  assert.equal(sync.current.markdown, "snapshot 7");
  assert.equal(sync.status.kind, "saved");
});

test("a save that fails on the network is retried until it succeeds", async () => {
  const server = fakeServer();
  let failures = 2;
  const flaky = {
    ...server.api,
    save: (...args: Parameters<typeof server.api.save>) =>
      failures-- > 0 ? Promise.reject(new TypeError("Failed to fetch")) : server.api.save(...args),
  };
  const sync = new DraftSync(flaky, "D", { revision: 1, content: content("initial") }, () => {}, 0, 0);
  sync.edit(content("typed offline"));
  await sync.flush();
  assert.equal(sync.status.kind, "error");
  // The retries run on timers; wait for the one that reaches the server.
  while (server.calls.length === 0) await new Promise((r) => setTimeout(r, 1));
  await server.releaseAll();
  assert.equal(server.stored(), "typed offline");
  assert.equal(sync.status.kind, "saved");
});

test("closing the editor saves once and does not retry afterwards", async () => {
  const server = fakeServer();
  let attempts = 0;
  const offline = {
    ...server.api,
    save: () => {
      attempts += 1;
      return Promise.reject(new TypeError("Failed to fetch"));
    },
  };
  const sync = new DraftSync(offline, "D", { revision: 1, content: content("initial") }, () => {}, 0, 0);
  sync.edit(content("typed offline"));
  await sync.close();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(attempts, 1);
});

test("a save the server rejects as invalid is not retried", async () => {
  const server = fakeServer();
  let calls = 0;
  const strict = {
    ...server.api,
    save: () => {
      calls += 1;
      return Promise.reject(new ApiError(422, { detail: "invalid" }));
    },
  };
  const sync = new DraftSync(strict, "D", { revision: 1, content: content("initial") }, () => {}, 0, 0);
  sync.edit(content("x"));
  await sync.flush();
  await server.releaseAll();
  assert.equal(calls, 1);
  assert.equal(sync.status.kind, "error");
});
