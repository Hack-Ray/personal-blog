import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { article, content } from "../../../test-fixtures/search.ts";
import { buildSearchAssets } from "../../content/search-assets.ts";
import { buildIndex, prepareIndex, search } from "../../content/search.ts";
import { createSearchStore } from "./load-index.ts";

const fixture = content(
  article("new", 2026, { title: "Needle", markdown: "x".repeat(180) + " needle newbody" }),
  article("old", 2024, { markdown: "x".repeat(180) + " needle oldbody" }),
);
const assets = buildSearchAssets(fixture);
const metadata = JSON.parse(assets.metadataJson);
const chunks = [...assets.chunks.values()].map((json) => JSON.parse(json));

function controlled(basePath = "") {
  const requests: { url: string; options?: RequestInit; resolve: (value: Response) => void; reject: (reason: Error) => void }[] = [];
  const fetcher: typeof fetch = (input, options) => new Promise((resolve, reject) => {
    requests.push({ url: String(input), options, resolve, reject });
  });
  return { ...createSearchStore(fetcher, basePath), requests };
}

const results = (store: ReturnType<typeof createSearchStore>, query: string) => search(store.getSearchSnapshot().docs, query).map(({ doc, score }) => ({ docId: doc.docId, score }));

test("subscriptions are passive; concurrent starts share sequential newest-first downloads and stable snapshots", async () => {
  const store = controlled("/prefix");
  let firstNotifications = 0;
  let secondNotifications = 0;
  const unsubscribe = store.subscribeSearch(() => firstNotifications++);
  store.subscribeSearch(() => secondNotifications++);
  const initial = store.getSearchSnapshot();
  assert.strictEqual(initial, store.getServerSearchSnapshot());
  await setImmediate();
  assert.equal(store.requests.length, 0);
  const first = store.startSearch();
  assert.strictEqual(first, store.startSearch());
  await setImmediate();
  assert.equal(store.requests.length, 1);
  assert.equal(store.requests[0].url, "/prefix/search-metadata.json");
  assert.equal(store.requests[0].options?.cache, "no-store");
  store.requests[0].resolve(Response.json(metadata));
  await setImmediate();
  const partial = store.getSearchSnapshot();
  assert.equal(partial.phase, "bodies");
  assert.strictEqual(partial, store.getSearchSnapshot());
  assert.strictEqual(initial, store.getServerSearchSnapshot());
  assert.deepEqual(results(store, "needle"), [{ docId: "new", score: 10 }]);
  assert.equal(store.requests.length, 2);
  assert.equal(store.requests[1].url, `/prefix/search-data/${metadata.years[0].asset}/chunk.json`);
  unsubscribe();
  const before = firstNotifications;
  store.requests[1].resolve(Response.json(chunks[0]));
  await setImmediate();
  assert.equal(firstNotifications, before);
  assert.ok(secondNotifications > before);
  assert.notStrictEqual(partial.docs, store.getSearchSnapshot().docs);
  assert.deepEqual(results(store, "needle"), [{ docId: "new", score: 11 }]);
  assert.equal(store.requests.length, 3);
  assert.equal(store.requests[2].url, `/prefix/search-data/${metadata.years[1].asset}/chunk.json`);
  store.requests[2].resolve(Response.json(chunks[1]));
  await first;
  assert.equal(store.getSearchSnapshot().phase, "complete");
  assert.deepEqual(results(store, "needle"), [{ docId: "new", score: 11 }, { docId: "old", score: 1 }]);
  assert.deepEqual(store.getSearchSnapshot().docs, prepareIndex(buildIndex(fixture)));
  await store.startSearch();
  assert.equal(store.requests.length, 3);
});

test("failure retains useful results and retry resumes only the failed year", async () => {
  const store = controlled();
  const run = store.startSearch();
  await setImmediate();
  store.requests[0].resolve(Response.json(metadata));
  await setImmediate();
  store.requests[1].resolve(Response.json(chunks[0]));
  await setImmediate();
  const before = store.getSearchSnapshot();
  store.requests[2].resolve(new Response("Unavailable", { status: 503 }));
  await run;
  const failed = store.getSearchSnapshot();
  assert.equal(failed.phase, "body-error");
  assert.strictEqual(failed.docs, before.docs);
  assert.ok(failed.phase === "body-error" && failed.failedYear === 2024 && failed.loadedYears === 1);
  assert.deepEqual(results(store, "newbody"), [{ docId: "new", score: 1 }]);
  const retry = store.startSearch();
  assert.strictEqual(retry, store.startSearch());
  await setImmediate();
  assert.equal(store.requests.length, 4);
  assert.equal(store.requests[3].url, store.requests[2].url);
  assert.equal(store.getSearchSnapshot().phase, "bodies");
  store.requests[3].resolve(Response.json(chunks[1]));
  await retry;
  assert.equal(store.getSearchSnapshot().phase, "complete");
  assert.deepEqual(results(store, "oldbody"), [{ docId: "old", score: 1 }]);
});

test("metadata failure is retryable without publishing invalid documents", async () => {
  const store = controlled();
  const run = store.startSearch();
  await setImmediate();
  store.requests[0].reject(new Error("offline"));
  await run;
  assert.equal(store.getSearchSnapshot().phase, "metadata-error");
  assert.deepEqual(store.getSearchSnapshot().docs, []);
  const retry = store.startSearch();
  await setImmediate();
  assert.equal(store.requests[1].url, "/search-metadata.json");
  store.requests[1].resolve(new Response(buildSearchAssets(content()).metadataJson));
  await retry;
  assert.equal(store.getSearchSnapshot().phase, "complete");
  assert.equal(store.requests.length, 2);
});

for (const publishedAt of ["-000001-01-01T00:00:00.000Z", "+010000-01-01T00:00:00.000Z"]) {
  test(`serialized assets complete search for publication date ${publishedAt}`, async () => {
    const source = content(article("outside-four-digits", 2026, {
      publishedAt: new Date(publishedAt),
      markdown: "x".repeat(180) + " distantbody",
    }));
    const built = buildSearchAssets(source);
    const responses = new Map([
      ["/search-metadata.json", built.metadataJson],
      ...[...built.chunks].map(([asset, json]) => [`/search-data/${asset}/chunk.json`, json] as const),
    ]);
    const requests: string[] = [];
    const store = createSearchStore(async (input) => {
      const url = String(input);
      requests.push(url);
      const json = responses.get(url);
      return new Response(json, { status: json === undefined ? 404 : 200 });
    }, "");

    await store.startSearch();

    const snapshot = store.getSearchSnapshot();
    assert.equal(snapshot.phase, "complete");
    assert.ok(snapshot.phase === "complete" && snapshot.loadedYears === 1 && snapshot.totalYears === 1);
    assert.equal(snapshot.docs[0].doc.publishedAt, publishedAt);
    assert.deepEqual(results(store, "distantbody"), [{ docId: "outside-four-digits", score: 1 }]);
    assert.deepEqual(requests, [...responses.keys()]);
  });
}

for (const [name, mutate] of [
  ["version", (data: typeof metadata) => { data.version = 2; }],
  ["duplicate documents", (data: typeof metadata) => { data.docs.push(data.docs[0]); }],
  ["fractional year", (data: typeof metadata) => { data.years[0].year += 0.5; }],
  ["year order", (data: typeof metadata) => { data.years.reverse(); }],
  ["asset path", (data: typeof metadata) => { data.years[0].asset = "../foreign"; }],
  ["year membership", (data: typeof metadata) => { data.years[0].docIds = ["old"]; }],
  ["missing year", (data: typeof metadata) => { data.years.pop(); }],
  ["invalid date", (data: typeof metadata) => { data.docs[0].publishedAt = "invalid"; }],
  ["unnormalized prefix", (data: typeof metadata) => { data.docs[0].textKey = "UPPER"; }],
] as const) {
  test(`metadata boundary rejects ${name}`, async () => {
    const invalid = structuredClone(metadata);
    mutate(invalid);
    let requests = 0;
    const store = createSearchStore(async () => { requests++; return Response.json(invalid); });
    await store.startSearch();
    assert.equal(store.getSearchSnapshot().phase, "metadata-error");
    assert.deepEqual(store.getSearchSnapshot().docs, []);
    assert.equal(requests, 1);
  });
}

test("a malformed chunk publishes none of its updates and can recover on retry", async () => {
  const source = content(article("one", 2026, { markdown: "a".repeat(180) + " token" }), article("two", 2026));
  const built = buildSearchAssets(source);
  const valid = JSON.parse([...built.chunks.values()][0]);
  for (const corrupt of [
    { ...valid, year: 2025 },
    { ...valid, docs: [valid.docs[0], valid.docs[0]] },
    { ...valid, docs: [valid.docs[0]] },
    { ...valid, docs: [valid.docs[0], { docId: "foreign", textKey: "" }] },
    { ...valid, docs: [{ ...valid.docs[0], textKey: "lost-prefix" }, valid.docs[1]] },
    { ...valid, docs: [valid.docs[0], { ...valid.docs[1], textKey: 5 }] },
  ]) {
    let count = 0;
    const store = createSearchStore(async () => {
      count++;
      return count === 1 ? new Response(built.metadataJson) : Response.json(count === 2 ? corrupt : valid);
    });
    await store.startSearch();
    assert.equal(store.getSearchSnapshot().phase, "body-error");
    assert.deepEqual(results(store, "token"), []);
    await store.startSearch();
    assert.equal(store.getSearchSnapshot().phase, "complete");
    assert.deepEqual(results(store, "token"), [{ docId: "one", score: 1 }]);
    assert.equal(count, 3);
  }
});

test("all partial Unicode matches remain after complete replacement without duplicate hits", async () => {
  const source = content(article("sigma", 2026, { markdown: "x".repeat(158) + "ΟΣΑ İ".repeat(1000) }));
  const built = buildSearchAssets(source);
  const store = controlled();
  const run = store.startSearch();
  await setImmediate();
  store.requests[0].resolve(new Response(built.metadataJson));
  await setImmediate();
  const partial = results(store, "οσ");
  assert.deepEqual(partial, [{ docId: "sigma", score: 1 }]);
  store.requests[1].resolve(new Response([...built.chunks.values()][0]));
  await run;
  assert.equal(store.getSearchSnapshot().phase, "complete");
  assert.deepEqual(results(store, "οσ"), partial);
  assert.deepEqual(store.getSearchSnapshot().docs, prepareIndex(buildIndex(source)));
});
