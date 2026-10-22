import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { assertTrial, expectedPrefetchCancellation, serveExport, summarize, validateInputMode } from "./bench-search-run.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("generated snapshot reruns byte for byte and probes uniquely identify their required posts", () => {
  const directory = mkdtempSync(join(tmpdir(), "bench-search-generator-"));
  try {
    const generate = () => execFileSync(process.execPath, [join(here, "bench-search-generate.mjs"), "--out", directory], { stdio: "pipe" });
    generate();
    const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
    const corpus = JSON.parse(readFileSync(join(directory, "bench-search-corpus.json"), "utf8"));
    const articles = manifest.articles.map((entry) => JSON.parse(readFileSync(join(directory, "articles", `${entry.doc_id}.json`), "utf8")));
    for (const id of [manifest.release_id, ...articles.map((article) => article.doc_id)]) assert.match(id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    assert.equal(articles.length, 1000);
    assert.equal(new Set(articles.map((article) => article.topic.slug)).size, 20);
    assert.equal(new Set(articles.flatMap((article) => article.tags.map((tag) => tag.slug))).size, 60);
    assert.deepEqual([...new Set(articles.map((article) => Number(article.published_at.slice(0, 4))))], [2023, 2024, 2025, 2026]);
    assert(articles.every((article) => article.markdown.length >= 1500 && article.markdown.length <= 8500 && !article.markdown.includes("![")));
    assert(Math.abs(corpus.characters.median - 4800) < 250);
    for (const [kind, probe] of Object.entries(corpus.probes)) {
      const matches = articles.filter((article) => [article.title, article.markdown, article.excerpt, article.topic.name, ...article.tags.map((tag) => tag.name)].some((text) => text.includes(probe.query)));
      assert.equal(matches.length, 1);
      assert.equal(matches[0].doc_id, probe.docId);
      assert.equal(matches[0].title, probe.title);
      if (kind === "body") {
        assert(!matches[0].title.includes(probe.query));
        assert(matches[0].markdown.slice(0, 4500).includes(probe.query));
        assert(matches[0].markdown.replace(/\s+/g, " ").indexOf(probe.query) >= 400);
        assert.equal(matches[0].published_at.slice(0, 4), "2023");
      }
    }
    for (const source of corpus.sourceCorpus) {
      const bytes = readFileSync(resolve(here, "../..", source.path));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
    }
    const before = [readFileSync(join(directory, "manifest.json")), readFileSync(join(directory, "profile.json")), ...readdirSync(join(directory, "articles")).sort().map((path) => readFileSync(join(directory, "articles", path)))];
    generate();
    const after = [readFileSync(join(directory, "manifest.json")), readFileSync(join(directory, "profile.json")), ...readdirSync(join(directory, "articles")).sort().map((path) => readFileSync(join(directory, "articles", path)))];
    assert.deepEqual(after, before);
    assert.equal(JSON.parse(readFileSync(join(directory, "bench-search-corpus.json"), "utf8")).snapshotSha256, corpus.snapshotSha256);
    writeFileSync(join(directory, "manifest.json"), "different snapshot");
    assert.notDeepEqual(readFileSync(join(directory, "manifest.json")), before[0]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function request(url, encoding = "gzip") {
  return new Promise((resolveRequest, reject) => {
    get(url, { headers: { "accept-encoding": encoding } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolveRequest({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    }).on("error", reject);
  });
}

test("static server strips the base path and serves exact gzip bytes with correct asset types", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bench-search-server-"));
  let server;
  try {
    mkdirSync(join(directory, "search"));
    const bodies = { "index.html": "<!doctype html><title>fixture</title>", "app.js": "document.title = 'fixture';", "index.txt": "route response", "search-index.json": '[{"docId":"expected"}]', "search/2023.json": '{"year":2023}' };
    for (const [path, body] of Object.entries(bodies)) writeFileSync(join(directory, path), body);
    server = await serveExport(directory);
    assert.equal(server.payload.files, 2);
    for (const [path, body] of Object.entries(bodies)) {
      const response = await request(`${server.origin}/personal-blog/${path === "index.html" ? "" : path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers["content-encoding"], "gzip");
      assert.equal(Number(response.headers["content-length"]), response.body.length);
      assert.equal(gunzipSync(response.body).toString(), body);
      const expected = path.endsWith(".json") ? "application/json" : path.endsWith(".txt") ? "text/plain" : path.endsWith(".js") ? "application/javascript" : "text/html";
      assert(response.headers["content-type"].startsWith(expected));
      assert.equal(server.logs.at(-1).bodyBytes, response.body.length);
    }
    assert.equal((await request(`${server.origin}/personal-blog`)).status, 308);
    assert.equal((await request(`${server.origin}/index.html`)).status, 404);
    assert.equal((await request(`${server.origin}/personal-blog/missing.json`)).status, 404);
    const identity = await request(`${server.origin}/personal-blog/index.txt`, "gzip;q=0, identity");
    assert.equal(identity.headers["content-encoding"], undefined);
    assert.equal(identity.body.toString(), bodies["index.txt"]);
    assert.equal(server.logs.filter((entry) => entry.status >= 400).length, 2);
  } finally {
    await server?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("results with errors, wrong documents, empty transfers, or failed downloads cannot produce statistics", () => {
  const valid = { errors: [], expected: { docId: "expected", title: "Correct title", query: "完整查詢" }, hit: { docId: "expected", title: "Correct title", query: "完整查詢", elapsedMs: 10 }, searchRequestsBeforeFocus: 0, searchRequests: [{ status: 200, finished: true, encoding: "gzip", encodedTransferBytes: 100 }], serverSearchBytes: 80, searchEncodedTransferBytes: 100, completePayload: true, fullCorpusDownloadMsFromFocus: 15, progressive: false, progressiveUiCompleteMsFromFocus: null };
  assert.doesNotThrow(() => assertTrial(valid));
  const bad = [
    { ...valid, errors: ["page error"] },
    { ...valid, hit: { ...valid.hit, docId: "wrong" } },
    { ...valid, hit: { ...valid.hit, title: "Wrong title" } },
    { ...valid, hit: { ...valid.hit, query: "整查詢" } },
    { ...valid, searchRequestsBeforeFocus: 1 },
    { ...valid, hit: { ...valid.hit, elapsedMs: NaN } },
    { ...valid, searchRequests: [] },
    ...[{ status: 404 }, { finished: false }, { encoding: "identity" }, { encodedTransferBytes: 0 }].map((change) => ({ ...valid, searchRequests: [{ ...valid.searchRequests[0], ...change }] })),
    { ...valid, serverSearchBytes: 0 },
    { ...valid, searchEncodedTransferBytes: 0 },
    { ...valid, completePayload: false },
    { ...valid, fullCorpusDownloadMsFromFocus: undefined },
    { ...valid, progressive: true, progressiveUiCompleteMsFromFocus: undefined },
  ];
  for (const trial of bad) assert.throws(() => assertTrial(trial));
  assert.deepEqual(summarize([8, 2, 6, 10, 4]), { n: 5, median: 6, min: 2, max: 10 });
  assert.throws(() => summarize([]));
  assert.throws(() => summarize([10, NaN]));
});

test("only identified canceled Next prefetches are diagnostics and active search or asset failures remain errors", () => {
  const failure = { canceled: true, errorText: "net::ERR_ABORTED" };
  const segment = { url: "http://localhost/personal-blog/posts/example/__next._tree.txt?_rsc=abc", type: "Fetch", headers: { rsc: "1", "next-router-prefetch": "1" } };
  const probe = { url: "http://localhost/personal-blog/posts/example/", type: "Fetch", mimeType: "text/html", headers: {} };
  assert.equal(expectedPrefetchCancellation(segment, failure, [segment]), true);
  assert.equal(expectedPrefetchCancellation(probe, failure, [segment]), true);
  for (const request of [
    { ...segment, headers: {} },
    { ...probe, type: "Document" },
    { ...probe, mimeType: "application/javascript" },
    { ...probe, url: "http://localhost/personal-blog/posts/different/" },
    { ...probe, url: "http://otherhost/personal-blog/posts/example/" },
    { ...segment, url: "http://localhost/personal-blog/search-index.json" },
    { ...segment, url: "http://localhost/personal-blog/search-metadata.json" },
    { ...segment, url: "http://localhost/personal-blog/search-data/2023/chunk.json" },
    { ...segment, url: "http://localhost/personal-blog/_next/main.js" },
    { ...segment, url: "http://localhost/personal-blog/_next/main.css" },
  ]) assert.equal(expectedPrefetchCancellation(request, failure, [segment]), false);
  assert.equal(expectedPrefetchCancellation(probe, failure, []), false);
  assert.equal(expectedPrefetchCancellation(segment, { ...failure, canceled: false }, [segment]), false);
  assert.equal(expectedPrefetchCancellation(segment, { ...failure, errorText: "net::ERR_CONNECTION_RESET" }, [segment]), false);
});

test("input protocol accepts explicit fill or sequential entry and rejects unsupported modes", () => {
  assert.equal(validateInputMode("fill"), "fill");
  assert.equal(validateInputMode("sequential"), "sequential");
  for (const mode of ["ime", "typing", "", undefined]) assert.throws(() => validateInputMode(mode));
});
