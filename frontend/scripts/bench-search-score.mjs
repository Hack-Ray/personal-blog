import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cpus, loadavg } from "node:os";
import { summarize } from "./bench-search-run.mjs";

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  assert(args[index + 1] && !args[index + 1].startsWith("--"), `${name} needs a value`);
  return args[index + 1];
}
if (args.includes("--help")) {
  console.log("node --experimental-strip-types frontend/scripts/bench-search-score.mjs --baseline /path/search.ts --candidate /path/search.ts --index /path/search-index.json --corpus /path/bench-search-corpus.json --report /path/score-report.json [--trials 5] [--queries 100] [--profile-side A|B]");
  process.exit(0);
}
const baselinePath = option("--baseline");
const candidatePath = option("--candidate");
const indexPath = option("--index");
const corpusPath = option("--corpus");
const reportPath = option("--report");
assert(baselinePath && candidatePath && indexPath && corpusPath && reportPath, "--baseline, --candidate, --index, --corpus and --report are required");
const baseline = await import(pathToFileURL(resolve(baselinePath)).href);
const candidate = await import(pathToFileURL(resolve(candidatePath)).href);
const indexBytes = readFileSync(indexPath);
const index = JSON.parse(indexBytes.toString("utf8"));
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
assert(Array.isArray(index) && index.length === 1000 && index.every((doc) => typeof doc.text === "string"), "Expected the same 1000-post legacy index for both scorers");
assert(typeof baseline.search === "function" && typeof candidate.search === "function" && typeof candidate.prepareIndex === "function", "Expected baseline.search, candidate.search and candidate.prepareIndex exports");
const prepared = candidate.prepareIndex(index);
const docOrdinals = new Map(index.map((doc, i) => [doc.docId, i + 1]));
assert.equal(docOrdinals.size, index.length, "Index contains duplicate document IDs");
const querySet = [corpus.probes.title.query, corpus.probes.body.query, "快照", "發布", "資料 模型", "api", "測試", "SEARCH", "不存在的關鍵字", "  靜態   網站  ", "", "   ", "後端", "自動化", "快取", "標籤"];
const queries = Number(option("--queries", "100"));
const trials = Number(option("--trials", "5"));
assert(Number.isInteger(queries) && queries >= 100, "At least 100 queries per sample are required");
assert(Number.isInteger(trials) && trials >= 5, "At least five alternating samples are required");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const signature = (hits) => JSON.stringify(hits.map(({ doc, score }) => [doc.docId, score]));
for (const query of querySet) assert.equal(signature(candidate.search(prepared, query)), signature(baseline.search(index, query)), `Scorers disagree for ${JSON.stringify(query)}`);
for (const probe of Object.values(corpus.probes)) {
  for (const [name, search, data] of [["A", baseline.search, index], ["B", candidate.search, prepared]]) {
    const hits = search(data, probe.query);
    assert.equal(hits.length, 1, `${name} probe must find exactly one post`);
    assert.equal(hits[0].doc.docId, probe.docId, `${name} probe found wrong post`);
  }
}
function run(side, count) {
  const search = side === "A" ? baseline.search : candidate.search;
  const data = side === "A" ? index : prepared;
  let checksum = 0;
  let hits = 0;
  const started = performance.now();
  for (let i = 0; i < count; i++) {
    const result = search(data, querySet[i % querySet.length]);
    hits += result.length;
    for (const hit of result) checksum = (Math.imul(checksum, 31) + hit.score + docOrdinals.get(hit.doc.docId)) >>> 0;
  }
  return { side, queries: count, hits, checksum, elapsedMs: performance.now() - started };
}
const report = { status: "inconclusive", scope: "CPU scorer only. Prepared keys are built before timing. This does not measure end-to-end search loading or network time.", index: { path: resolve(indexPath), sha256: digest(indexBytes), docs: index.length }, corpusSha256: corpus.snapshotSha256, environment: { node: process.version, logicalCpus: cpus().length, loadAverageStart: loadavg() }, sourceSha256: { A: digest(readFileSync(baselinePath)), B: digest(readFileSync(candidatePath)) }, querySet, trials, queriesPerSample: queries, errors: 0, runs: [] };
try {
  const profileSide = option("--profile-side");
  if (profileSide) {
    assert(["A", "B"].includes(profileSide), "--profile-side must be A or B");
    const runResult = run(profileSide, queries);
    report.profileWork = { side: profileSide, queries: runResult.queries, hits: runResult.hits, checksum: runResult.checksum };
    report.status = "profile-only";
  } else {
    run("A", queries);
    run("B", queries);
    for (let iteration = 1; iteration <= trials; iteration++) {
      for (const side of ["A", "B"]) report.runs.push({ iteration, ...run(side, queries) });
    }
    assert.equal(new Set(report.runs.map((run) => `${run.hits}:${run.checksum}`)).size, 1, "Timed samples performed different search work");
    assert(report.runs.every((run) => run.hits > 0 && run.elapsedMs > 0), "Timed search work did not happen");
    report.millisecondsPerQuery = Object.fromEntries(["A", "B"].map((side) => [side, summarize(report.runs.filter((run) => run.side === side).map((run) => run.elapsedMs / run.queries))]));
    report.status = "measured";
  }
} catch (error) {
  report.errors++;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.environment.loadAverageEnd = loadavg();
  mkdirSync(dirname(resolve(reportPath)), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, errors: report.errors, profileWork: report.profileWork, millisecondsPerQuery: report.millisecondsPerQuery, report: resolve(reportPath) }, null, 2));
}
