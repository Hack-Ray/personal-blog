# Compare search in production exports

Use Node 22.22 or later and the frontend's existing Playwright package. Run the commands from the repository root. Keep generated snapshots, exports, and profiles outside the checkout. Keep raw local reports out of git.

1. Run the deterministic generator and validate its snapshot.

```sh
node frontend/scripts/bench-search-generate.mjs --out /tmp/search-snapshot
(cd frontend && SITE_DATA_DIR=/tmp/search-snapshot node scripts/check-snapshot.ts)
```

The generator uses a fixed seed and Chinese prose paragraphs from `docs/`. It creates 1000 posts, 20 topics, 60 tags, and four publication years. The separate `bench-search-corpus.json` records the source hashes, snapshot hash, lengths, and expected title and body probes. Its oldest-year body probe occurs after character 400 and before character 4500, outside the metadata preview and inside the legacy index limit. Repeated paragraphs can compress better than unrelated articles.

2. Build each revision in a separate checkout with the same snapshot, Node version, dependencies, and production environment. Preserve both `out` directories. Do not compare a development server with a static export.

3. Run the benchmark. Set `CHROMIUM_EXECUTABLE_PATH` if the Playwright browser download is unavailable.

```sh
CHROMIUM_EXECUTABLE_PATH=/path/to/chromium \
node frontend/scripts/bench-search-run.mjs \
	--a /tmp/baseline-out \
	--b /tmp/candidate-out \
	--corpus /tmp/search-snapshot/bench-search-corpus.json \
	--report /tmp/search-mobile-report.json \
	--playwright /path/to/frontend/node_modules/@playwright/test
```

The runner serves both exports under `/personal-blog` with gzip level 6. It serves HTML, JSON, JavaScript, styles, and Next.js text responses with their correct content types. For each probe, it alternates five trials per side. Each trial opens a fresh context with no browser cache or service workers. Mobile trials use a 390 by 844 viewport, 1.6 Mbps download, 750 Kbps upload, 150 ms latency, and fourfold CPU slowdown through CDP. Add `--desktop` for an unthrottled 1440 by 900 comparison.

Before timing, each fresh page reaches network idle, runs `requestIdleCallback`, and waits for two animation frames. The runner then verifies that no search payload has loaded. This measures a page that has reached browser idle with a cold search index. Page loading and hydration startup are outside the timed region. Readiness timestamps are preserved in every trial.

Each cold timer starts before focus and waits one animation frame after focus inside the timer. The default `--input-mode fill` then commits the complete Chinese phrase through Playwright's fill action. This measures focus and committing a full query until the expected hit becomes visible. It does not reproduce keyboard IME composition or per-character input latency. Physical IME behavior remains unverified.

Use `--input-mode sequential --type-delay 30` to diagnose separate character events. Early exploratory interaction lost input in both fill and sequential modes before the browser-idle readiness step existed. The runner preserves input events, observed value changes, the failed query, and DOM in its report. It never repairs the query or accepts its timing. Both modes assert the exact final input value and expected document's exact title and link in the search dropdown. Apply the same input mode to both variants.

The runner separately waits for every active search payload on both sides and measures full download time with ResourceTiming. It records the progressive UI's completed status as a candidate-only diagnostic. It never treats that status as an equivalent baseline UI readiness measurement. It then measures six query updates with the complete corpus loaded. The baseline uses `search-index.json`. The candidate uses `search-metadata.json` and every advertised year asset. Retained legacy exports appear separately in the report and do not inflate active payload totals.

The report contains every trial, exact encoded server body lengths, CDP transfer lengths, download timings, search file counts, active raw and gzip payload sizes, medians, and ranges. CDP transfer lengths include transport overhead. Body bytes received before the hit use CDP data events. Browser, console, HTTP, download, and result failures produce an inconclusive report and a nonzero exit. Failed runs never produce aggregate performance statistics. Canceled Next.js prefetches appear as diagnostics only when their request headers or a paired same-route RSC request identify them. Canceled search payloads, scripts, styles, and unidentified requests remain errors.

The local HTTP/1.1 server does not reproduce a CDN, DNS, TLS, HTTP/2, or Brotli. Chromium emulation does not reproduce a physical phone. Check host load before interpreting a difference. Identify the limiter with a separate untimed profile before making a speedup claim.

4. Run the scorer comparison against the same legacy index when you need CPU evidence.

```sh
node --experimental-strip-types frontend/scripts/bench-search-score.mjs \
	--baseline /path/baseline/frontend/src/content/search.ts \
	--candidate /path/candidate/frontend/src/content/search.ts \
	--index /tmp/baseline-out/search-index.json \
	--corpus /tmp/search-snapshot/bench-search-corpus.json \
	--report /tmp/search-score-report.json
```

The scorer prepares the candidate's lowercase keys before timing. It checks exact ordered document IDs and scores for the query set, then alternates five samples of 100 queries per side. Every sample consumes the hit count, document IDs, and scores in a checksum. This CPU measurement does not include downloading or preparing the index.

Run a separate profile without reporting its timings.

```sh
node --experimental-strip-types --cpu-prof --cpu-prof-dir=/tmp \
	frontend/scripts/bench-search-score.mjs \
	--baseline /path/baseline/frontend/src/content/search.ts \
	--candidate /path/candidate/frontend/src/content/search.ts \
	--index /tmp/baseline-out/search-index.json \
	--corpus /tmp/search-snapshot/bench-search-corpus.json \
	--report /tmp/search-profile-work.json \
	--profile-side A --queries 10000
```

Use `--profile-side B` for the prepared scorer. The profile-only report records work counts and a checksum without performance statistics.

5. Run the tooling controls before trusting a comparison.

```sh
node --test frontend/scripts/bench-search-tools.test.mjs
```

The controls rerun the generator byte for byte, verify the source hashes and probes, check gzip transport and asset types, and reject wrong result documents, wrong titles, empty bytes, HTTP failures, and incomplete downloads. Cancellation controls verify that known Next.js prefetches are diagnostics and search or real asset failures remain errors.
