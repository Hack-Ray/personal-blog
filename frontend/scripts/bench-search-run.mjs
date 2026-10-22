import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { cpus, loadavg } from "node:os";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const defaultSearchPattern = /\/search(?:[-/]).*\.json$/;
const mime = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".css": "text/css; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2" };
const compressible = new Set([".html", ".js", ".json", ".txt", ".css", ".xml", ".svg"]);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }).sort();
}

export function summarize(values) {
  assert(values.length > 0 && values.every(Number.isFinite), "Cannot summarize missing or invalid measurements");
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { n: sorted.length, median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, min: sorted[0], max: sorted.at(-1) };
}

export function validateInputMode(value) {
  assert(["fill", "sequential"].includes(value), "--input-mode must be fill or sequential");
  return value;
}

export async function serveExport(directory, { basePath = "/personal-blog", searchPattern = defaultSearchPattern, probes } = {}) {
  const root = resolve(directory);
  assert(existsSync(join(root, "index.html")), `${root} is not a production static export`);
  const cache = new Map();
  const logs = [];
  function asset(path) {
    if (!cache.has(path)) {
      const raw = readFileSync(path);
      const gzip = compressible.has(extname(path)) ? gzipSync(raw, { level: 6 }) : undefined;
      cache.set(path, { raw, gzip });
    }
    return cache.get(path);
  }
  const paths = files(root);
  const exportedInventory = paths.filter((path) => searchPattern.test(`${basePath}/${relative(root, path).split(sep).join("/")}`)).map((path) => {
    const { raw, gzip } = asset(path);
    JSON.parse(raw.toString("utf8"));
    return { path: `${basePath}/${relative(root, path).split(sep).join("/")}`, rawBytes: raw.length, gzipBytes: gzip.length, sha256: hash(raw) };
  });
  const metadata = exportedInventory.find((entry) => entry.path === `${basePath}/search-metadata.json`);
  let inventory = exportedInventory;
  if (metadata) {
    const manifest = JSON.parse(asset(join(root, "search-metadata.json")).raw.toString("utf8"));
    assert(Array.isArray(manifest.years) && Array.isArray(manifest.docs), "Invalid progressive search metadata");
    const active = new Set([metadata.path, ...manifest.years.map((year) => `${basePath}/search-data/${year.asset}/chunk.json`)]);
    for (const path of active) assert(exportedInventory.some((entry) => entry.path === path), `Advertised search asset is absent: ${path}`);
    inventory = exportedInventory.filter((entry) => active.has(entry.path));
    if (probes) {
      assert.equal(manifest.docs.length, 1000, "Metadata must contain every generated post");
      assert(!JSON.stringify(manifest.docs).includes(probes.body.query), "Body-only probe leaked into metadata. Regenerate the corpus with a later probe offset");
      assert(manifest.docs.some((doc) => doc.docId === probes.title.docId && doc.title === probes.title.title), "Expected title probe is absent from metadata");
    }
  }
  assert(inventory.length > 0, `No search payloads found in ${root}. Set --search-pattern if paths differ`);
  for (const path of paths) if ([".js", ".css"].includes(extname(path))) asset(path);
  let sequence = 0;
  const server = createServer((request, response) => {
    const entry = { id: String(++sequence), url: request.url, method: request.method, status: 0, bodyBytes: 0, encoding: "identity" };
    logs.push(entry);
    response.setHeader("x-bench-request-id", entry.id);
    response.setHeader("cache-control", "no-store");
    response.setHeader("vary", "Accept-Encoding");
    function send(status, body, type) {
      entry.status = status;
      entry.bodyBytes = body.length;
      response.writeHead(status, { "content-type": type, "content-length": body.length });
      response.end(request.method === "HEAD" ? undefined : body);
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === basePath) {
        entry.status = 308;
        response.writeHead(308, { location: `${basePath}/` });
        response.end();
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") return send(405, Buffer.from("Method not allowed"), "text/plain");
      if (basePath && !pathname.startsWith(`${basePath}/`)) return send(404, Buffer.from("Not found"), "text/plain");
      let path = resolve(root, `.${pathname.slice(basePath.length)}`);
      if (path !== root && !path.startsWith(`${root}${sep}`)) return send(403, Buffer.from("Forbidden"), "text/plain");
      if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
      if (!existsSync(path) || !statSync(path).isFile()) return send(404, Buffer.from("Not found"), "text/plain");
      const { raw, gzip } = asset(path);
      const compressed = gzip && (request.headers["accept-encoding"] ?? "").split(",").some((part) => {
        const [encoding, ...parameters] = part.trim().toLowerCase().split(";");
        return encoding === "gzip" && !parameters.some((parameter) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(parameter));
      });
      if (compressed) {
        response.setHeader("content-encoding", "gzip");
        entry.encoding = "gzip";
      }
      send(200, compressed ? gzip : raw, mime[extname(path)] ?? "application/octet-stream");
    } catch (error) {
      entry.error = error.message;
      send(500, Buffer.from("Benchmark server error"), "text/plain");
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`, logs, inventory, progressive: Boolean(metadata),
    payload: { files: inventory.length, rawBytes: inventory.reduce((sum, entry) => sum + entry.rawBytes, 0), gzipBytes: inventory.reduce((sum, entry) => sum + entry.gzipBytes, 0), entries: inventory, inactiveExportedEntries: exportedInventory.filter((entry) => !inventory.includes(entry)) },
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

export function assertTrial(trial) {
  assert.equal(trial.errors.length, 0, `Trial has errors: ${trial.errors.join("; ")}`);
  assert.equal(trial.hit.docId, trial.expected.docId, "Unexpected result document");
  assert.equal(trial.hit.title, trial.expected.title, "Unexpected result title");
  assert.equal(trial.hit.query, trial.expected.query, "The input query differs from the benchmark probe");
  assert.equal(trial.searchRequestsBeforeFocus, 0, "Search data loaded before the cold interaction");
  assert(Number.isFinite(trial.hit.elapsedMs) && trial.hit.elapsedMs > 0, "Missing hit time");
  assert(trial.searchRequests.length > 0, "Result appeared without a search request");
  assert(trial.searchRequests.every((request) => request.status === 200 && request.finished && request.encoding === "gzip" && request.encodedTransferBytes > 0), "Search work did not complete through gzip transport");
  assert(trial.serverSearchBytes > 0, "No search bytes reached the server connection");
  assert(trial.searchEncodedTransferBytes > 0, "Browser recorded zero search transfer bytes");
  assert.equal(trial.completePayload, true, "Full advertised search corpus did not download");
  assert(Number.isFinite(trial.fullCorpusDownloadMsFromFocus) && trial.fullCorpusDownloadMsFromFocus > 0, "Full download time is missing");
  if (trial.progressive) assert(Number.isFinite(trial.progressiveUiCompleteMsFromFocus) && trial.progressiveUiCompleteMsFromFocus > 0, "Progressive completed UI time is missing");
}

export function expectedPrefetchCancellation(request, failure, requests, searchPattern = defaultSearchPattern) {
  if (!request || !failure.canceled || failure.errorText !== "net::ERR_ABORTED" || request.type !== "Fetch") return false;
  const url = new URL(request.url);
  if (searchPattern.test(url.pathname)) return false;
  const headers = Object.fromEntries(Object.entries(request.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const segment = /\/__next\.[^/]+\.txt$/.test(url.pathname) && url.searchParams.has("_rsc");
  if (segment && headers.rsc === "1" && headers["next-router-prefetch"] === "1") return true;
  if (!url.pathname.endsWith("/") || request.mimeType !== "text/html") return false;
  return requests.some((related) => {
    const relatedUrl = new URL(related.url);
    const relatedHeaders = Object.fromEntries(Object.entries(related.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    return relatedUrl.origin === url.origin && relatedUrl.pathname.replace(/__next\.[^/]+\.txt$/, "") === url.pathname && relatedHeaders.rsc === "1" && relatedHeaders["next-router-prefetch"] === "1";
  });
}

async function measureHit(page, input, probe, timeout, typeDelay, fill = false, completion) {
  await page.evaluate(({ probe, timeout, completion }) => {
    window.__benchSearchInputCleanup?.();
    window.__benchSearchHit = undefined;
    window.__benchSearchInputEvents = [];
    if (completion) window.__benchSearchFullComplete = undefined;
    const started = performance.now();
    const input = document.querySelector('input[aria-label="搜尋文章"]');
    const record = (type, event) => window.__benchSearchInputEvents.push({ type, value: input?.value, inputType: event?.inputType, data: event?.data, timeMs: performance.now() - started });
    const events = ["focus", "beforeinput", "input", "change", "blur"];
    const listeners = events.map((type) => {
      const listener = (event) => record(type, event);
      input.addEventListener(type, listener);
      return [type, listener];
    });
    window.__benchSearchInputCleanup = () => listeners.forEach(([type, listener]) => input.removeEventListener(type, listener));
    let previousValue = input.value;
    record("initial");
    const check = () => {
      if (input.value !== previousValue) {
        record("frame-value-change");
        previousValue = input.value;
      }
      const link = [...document.querySelectorAll('form[role="search"] a[href]')].find((candidate) => {
        const href = new URL(candidate.href).pathname;
        const style = getComputedStyle(candidate);
        return href.endsWith(`/posts/${probe.docId}/`) && candidate.textContent === probe.title && candidate.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
      if (!window.__benchSearchHit && input?.value === probe.query && link) {
        window.__benchSearchHit = { docId: probe.docId, title: link.textContent, href: link.href, query: input.value, elapsedMs: performance.now() - started, performanceTimeMs: performance.now() };
      }
      if (completion && window.__benchSearchFullComplete === undefined) {
        const finished = new Set(performance.getEntriesByType("resource").map((entry) => new URL(entry.name).pathname));
        if (completion.paths.every((path) => finished.has(path)) && (!completion.progressive || document.querySelector('form[role="search"] [data-search-phase="complete"]'))) window.__benchSearchFullComplete = performance.now();
      }
      if ((!window.__benchSearchHit || (completion && window.__benchSearchFullComplete === undefined)) && performance.now() - started < timeout) {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);
  }, { probe, timeout, completion });
  await input.focus();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  if (fill) await input.fill(probe.query);
  else await input.pressSequentially(probe.query, { delay: typeDelay });
  assert.equal(await input.inputValue(), probe.query, "Search input lost characters while typing. Refusing a timing for a different query");
  await page.waitForFunction(() => window.__benchSearchHit !== undefined, undefined, { timeout });
  assert.equal(await input.inputValue(), probe.query, "Search input changed after the expected hit appeared");
  return page.evaluate(() => window.__benchSearchHit);
}

async function runTrial(browser, server, options, probe, variant, iteration) {
  const inputMode = validateInputMode(options.inputMode ?? "fill");
  const errors = [];
  const failures = [];
  const context = await browser.newContext({ viewport: options.desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: !options.desktop, hasTouch: !options.desktop, serviceWorkers: "block" });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const requests = new Map();
  let serverLogStart = server.logs.length;
  const trial = { variant, iteration, scenario: probe.kind, inputMode, progressive: server.progressive, expected: probe, errors, diagnostics: [], warmUpdates: [] };
  try {
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: options.desktop ? 0 : 150, downloadThroughput: options.desktop ? -1 : 1600000 / 8, uploadThroughput: options.desktop ? -1 : 750000 / 8, connectionType: options.desktop ? "ethernet" : "cellular4g" });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: options.desktop ? 1 : 4 });
    cdp.on("Network.requestWillBeSent", (event) => requests.set(event.requestId, { url: event.request.url, headers: event.request.headers, started: event.timestamp, wallTime: event.wallTime, type: event.type, chunks: [] }));
    cdp.on("Network.responseReceived", (event) => {
      const request = requests.get(event.requestId);
      if (!request) return;
      const headers = Object.fromEntries(Object.entries(event.response.headers).map(([name, value]) => [name.toLowerCase(), value]));
      Object.assign(request, { status: event.response.status, responseAt: event.timestamp, encoding: headers["content-encoding"] ?? "identity", serverId: headers["x-bench-request-id"], mimeType: event.response.mimeType, fromDiskCache: event.response.fromDiskCache });
      if (event.response.status >= 400) errors.push(`HTTP ${event.response.status} ${event.response.url}`);
    });
    cdp.on("Network.dataReceived", (event) => requests.get(event.requestId)?.chunks.push({ timestamp: event.timestamp, encodedBytes: event.encodedDataLength, decodedBytes: event.dataLength }));
    cdp.on("Network.loadingFinished", (event) => {
      const request = requests.get(event.requestId);
      if (request) Object.assign(request, { finished: true, finishedAt: event.timestamp, encodedTransferBytes: event.encodedDataLength, downloadMs: (event.timestamp - request.started) * 1000 });
    });
    cdp.on("Network.loadingFailed", (event) => failures.push(event));
    page.on("pageerror", (error) => errors.push(`Page error: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`Console error: ${message.text()}`); });
    await page.goto(`${server.origin}${options.basePath}/`, { waitUntil: "networkidle", timeout: options.timeout });
    const input = page.getByRole("searchbox", { name: "搜尋文章" });
    await input.waitFor({ state: "visible", timeout: options.timeout });
    trial.pageReadiness = await page.evaluate(() => new Promise((resolveReady) => {
      const startedPerformanceMs = performance.now();
      requestIdleCallback(() => {
        const idlePerformanceMs = performance.now();
        requestAnimationFrame(() => {
          const firstFramePerformanceMs = performance.now();
          requestAnimationFrame(() => resolveReady({ method: "requestIdleCallback then two animation frames", startedPerformanceMs, idlePerformanceMs, firstFramePerformanceMs, readyPerformanceMs: performance.now() }));
        });
      });
    }));
    assert.equal(await input.inputValue(), "", "Cold scenario must start with an empty search input");
    trial.searchRequestsBeforeFocus = [...requests.values()].filter((request) => options.searchPattern.test(new URL(request.url).pathname)).length;
    assert.equal(trial.searchRequestsBeforeFocus, 0, "Search preloaded before focus. This protocol cannot call it cold");
    trial.timeOriginMs = await page.evaluate(() => performance.timeOrigin);
    trial.hit = await measureHit(page, input, probe, options.timeout, options.typeDelay, inputMode === "fill", server.progressive ? { paths: server.inventory.map((entry) => entry.path), progressive: true } : undefined);
    trial.coldInputEvents = await page.evaluate(() => window.__benchSearchInputEvents);
    await page.waitForFunction((expectedPaths) => {
      const finished = new Set(performance.getEntriesByType("resource").map((entry) => new URL(entry.name).pathname));
      return expectedPaths.every((path) => finished.has(path));
    }, server.inventory.map((entry) => entry.path), { timeout: options.timeout });
    trial.fullCorpusDownloadPerformanceMs = await page.evaluate((expectedPaths) => Math.max(...performance.getEntriesByType("resource").filter((entry) => expectedPaths.includes(new URL(entry.name).pathname)).map((entry) => entry.responseEnd)), server.inventory.map((entry) => entry.path));
    trial.fullCorpusDownloadMsFromFocus = trial.fullCorpusDownloadPerformanceMs - (trial.hit.performanceTimeMs - trial.hit.elapsedMs);
    trial.progressiveUiCompleteMsFromFocus = null;
    if (server.progressive) {
      await page.waitForFunction(() => window.__benchSearchFullComplete !== undefined, undefined, { timeout: options.timeout });
      trial.progressiveUiCompleteMsFromFocus = await page.evaluate(() => window.__benchSearchFullComplete) - (trial.hit.performanceTimeMs - trial.hit.elapsedMs);
    }
    await page.waitForLoadState("networkidle", { timeout: options.timeout });
    const searchRequests = [...requests.values()].filter((request) => options.searchPattern.test(new URL(request.url).pathname));
    const loaded = new Set(searchRequests.filter((request) => request.finished).map((request) => new URL(request.url).pathname));
    trial.completePayload = server.inventory.every((entry) => loaded.has(entry.path));
    for (const request of searchRequests) assert(server.inventory.some((entry) => entry.path === new URL(request.url).pathname), `Unadvertised search payload downloaded: ${request.url}`);
    if (trial.completePayload) {
      const other = probe.kind === "title" ? options.probes.body : options.probes.title;
      for (let index = 0; index < 6; index++) {
        const next = index % 2 === 0 ? other : probe;
        const hit = await measureHit(page, input, next, options.timeout, options.typeDelay, true);
        trial.warmUpdates.push({ query: next.query, ...hit });
      }
    } else {
      trial.warmUpdateUnavailable = "Not every search payload finished. Warm update measurements require complete corpus loading.";
    }
    const allRequests = [...requests.values()];
    const relativeTime = (request, timestamp) => request.wallTime * 1000 - trial.timeOriginMs + (timestamp - request.started) * 1000;
    trial.requests = allRequests.map((request) => ({ ...request, startedPerformanceMs: request.wallTime * 1000 - trial.timeOriginMs, completedPerformanceMs: request.finishedAt === undefined ? undefined : relativeTime(request, request.finishedAt) }));
    trial.searchRequests = trial.requests.filter((request) => options.searchPattern.test(new URL(request.url).pathname));
    trial.searchEncodedTransferBytes = trial.searchRequests.reduce((sum, request) => sum + (request.encodedTransferBytes ?? 0), 0);
    trial.searchEncodedBodyBytesAtHit = trial.searchRequests.reduce((sum, request) => sum + request.chunks.filter((chunk) => relativeTime(request, chunk.timestamp) <= trial.hit.performanceTimeMs).reduce((total, chunk) => total + chunk.encodedBytes, 0), 0);
    trial.searchFilesRequested = new Set(trial.searchRequests.map((request) => new URL(request.url).pathname)).size;
    trial.searchFilesCompletedAtHit = trial.searchRequests.filter((request) => request.completedPerformanceMs <= trial.hit.performanceTimeMs).length;
    trial.allCompletedEncodedTransferBytes = trial.requests.reduce((sum, request) => sum + (request.encodedTransferBytes ?? 0), 0);
    trial.serverRequests = server.logs.slice(serverLogStart);
    trial.serverSearchBytes = trial.serverRequests.filter((entry) => options.searchPattern.test(new URL(entry.url, server.origin).pathname)).reduce((sum, entry) => sum + entry.bodyBytes, 0);
    for (const entry of trial.serverRequests) if (entry.status >= 400 || entry.error) errors.push(`Server ${entry.status} ${entry.url}${entry.error ? `: ${entry.error}` : ""}`);
    for (const failure of failures) {
      const request = requests.get(failure.requestId);
      if (expectedPrefetchCancellation(request, failure, [...requests.values()], options.searchPattern)) trial.diagnostics.push({ kind: "next-prefetch-canceled", url: request.url, errorText: failure.errorText });
      else errors.push(`Request failed ${request?.url ?? failure.requestId}: ${failure.errorText}`);
    }
    assertTrial(trial);
  } catch (error) {
    errors.push(error.message);
    trial.serverRequests ??= server.logs.slice(serverLogStart);
    trial.requests ??= [...requests.values()];
    trial.failureState = await page.evaluate(() => ({ value: document.querySelector('input[aria-label="搜尋文章"]')?.value, inputEvents: window.__benchSearchInputEvents, searchForm: document.querySelector('form[role="search"]')?.outerHTML, observerHit: window.__benchSearchHit, observerFullComplete: window.__benchSearchFullComplete })).catch(() => undefined);
    trial.networkFailures = failures.map((failure) => ({ ...failure, url: requests.get(failure.requestId)?.url }));
  } finally {
    await context.close();
  }
  return trial;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("node frontend/scripts/bench-search-run.mjs --a /path/baseline/out --b /path/candidate/out --corpus /path/snapshot/bench-search-corpus.json --report /path/report.json [--trials 5] [--desktop] [--playwright /path/node_modules/@playwright/test] [--base-path /personal-blog] [--search-pattern regex] [--timeout 120000] [--input-mode fill|sequential] [--type-delay 30]");
    return;
  }
  function option(name, fallback) {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    assert(args[index + 1] && !args[index + 1].startsWith("--"), `${name} needs a value`);
    return args[index + 1];
  }
  const a = option("--a");
  const b = option("--b");
  const corpusPath = option("--corpus");
  const reportPath = option("--report");
  assert(a && b && corpusPath && reportPath, "--a, --b, --corpus and --report are required");
  const trials = Number(option("--trials", "5"));
  assert(Number.isInteger(trials) && trials >= 5, "At least five alternating trials per side are required");
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  assert(corpus.articleCount === 1000 && corpus.probes?.title?.docId && corpus.probes?.body?.docId, "Invalid benchmark corpus manifest");
  const searchPattern = option("--search-pattern") ? new RegExp(option("--search-pattern")) : defaultSearchPattern;
  const basePath = option("--base-path", "/personal-blog");
  assert(basePath === "" || (basePath.startsWith("/") && !basePath.endsWith("/")), "base path must be empty or start with / without a trailing slash");
  const options = { trials, desktop: args.includes("--desktop"), searchPattern, basePath, probes: corpus.probes, timeout: Number(option("--timeout", "120000")), inputMode: validateInputMode(option("--input-mode", "fill")), typeDelay: Number(option("--type-delay", "30")) };
  assert(Number.isFinite(options.timeout) && options.timeout > 0 && Number.isFinite(options.typeDelay) && options.typeDelay >= 0);
  const require = createRequire(import.meta.url);
  let playwrightPath = option("--playwright") ?? process.env.PLAYWRIGHT_PACKAGE;
  if (!playwrightPath) {
    try { playwrightPath = require.resolve("@playwright/test"); }
    catch { playwrightPath = resolve(here, "../../../personal-blog/frontend/node_modules/@playwright/test"); }
  }
  const { chromium } = require(playwrightPath);
  const report = {
    status: "inconclusive", claimUnderTest: "Compare search interaction after page network idle, a browser idle callback and two paint frames, with a cold search index, from focus and query commitment to the expected title or oldest-year body-only hit. Page loading and hydration startup are outside the timed region.",
    protocol: { trialsPerSidePerScenario: trials, order: "A,B,A,B for each scenario", freshContextPerScenarioTrial: true, viewport: options.desktop ? "1440x900" : "390x844", mobile: !options.desktop, downloadBitsPerSecond: options.desktop ? null : 1600000, uploadBitsPerSecond: options.desktop ? null : 750000, roundTripLatencyMs: options.desktop ? 0 : 150, cpuSlowdown: options.desktop ? 1 : 4, gzipLevel: 6, basePath, inputMode: options.inputMode, typeDelayMsPerCharacter: options.inputMode === "sequential" ? options.typeDelay : null, searchPattern: searchPattern.source, timer: `Before focus, one animation frame after focus inside the timer, ${options.inputMode === "fill" ? "fill commits the full phrase" : "sequential character entry"}, exact final input assertion, then expected visible result`, warmUpdateTimer: "Before focus and fill until expected result is visible after complete search payload download", completionMetric: "Full download uses all advertised ResourceTiming responseEnd values on both sides. Progressive UI completed status is a candidate-only diagnostic, never an equivalent baseline readiness measure.", cancellationPolicy: "Only canceled ERR_ABORTED Fetch requests with explicit Next RSC prefetch headers or paired same-route RSC prefetch evidence are diagnostics. Active search, scripts, styles, HTTP failures and console errors remain failures.", transferMetric: "CDP Network.loadingFinished.encodedDataLength includes encoded body and transport overhead. Body bytes at hit use CDP Network.dataReceived. Server logs record exact encoded body lengths.", limitations: ["Fill commits a complete Chinese phrase. It does not reproduce keyboard IME composition or per-character input latency. Physical IME behavior is unverified.", "Immediate synthetic sequential Chinese input lost its first character under CPU4x in diagnostic runs. Such runs are rejected, not repaired or accepted.", "Synthetic Chinese prose reuses repository paragraphs and may compress better than independent posts.", "Local in-process server uses HTTP/1.1 and gzip. CDN, HTTP/2, Brotli, DNS and TLS are not simulated.", "No automatic speedup verdict. A separate untimed profile must identify the limiter before interpreting a measured difference.", "Mobile viewport and CPU/network throttling are desktop Chromium emulation, not a physical phone."] },
    environment: { node: process.version, platform: process.platform, architecture: process.arch, logicalCpus: cpus().length, loadAverageStart: loadavg(), chromiumExecutableOverride: process.env.CHROMIUM_EXECUTABLE_PATH ?? null },
    corpus, variants: {}, runs: [],
  };
  let browser;
  const servers = {};
  try {
    servers.A = await serveExport(a, options);
    servers.B = await serveExport(b, options);
    report.variants = { A: { directory: resolve(a), payload: servers.A.payload }, B: { directory: resolve(b), payload: servers.B.payload } };
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
    report.environment.chromium = browser.version();
    for (const kind of ["title", "body"]) {
      for (let iteration = 1; iteration <= trials; iteration++) {
        for (const variant of ["A", "B"]) {
          const trial = await runTrial(browser, servers[variant], options, { ...corpus.probes[kind], kind }, variant, iteration);
          report.runs.push(trial);
          mkdirSync(dirname(resolve(reportPath)), { recursive: true });
          writeFileSync(reportPath, json(report));
          console.log(`${kind} ${variant} ${iteration}/${trials} ${trial.errors.length ? `FAILED ${trial.errors.join("; ")}` : `${trial.hit.elapsedMs.toFixed(1)} ms, ${trial.searchEncodedTransferBytes} search transfer bytes, ${trial.searchFilesRequested} search files`}`);
          assert.equal(trial.errors.length, 0, "A trial failed. Refusing aggregate statistics. Inspect the inconclusive report.");
        }
      }
    }
    for (const variant of ["A", "B"]) {
      report.variants[variant].measurements = {};
      for (const kind of ["title", "body"]) {
        const runs = report.runs.filter((run) => run.variant === variant && run.scenario === kind);
        report.variants[variant].measurements[kind] = {
          focusToExpectedHitMs: summarize(runs.map((run) => run.hit.elapsedMs)),
          searchEncodedTransferBytes: summarize(runs.map((run) => run.searchEncodedTransferBytes)),
          searchEncodedBodyBytesAtHit: summarize(runs.map((run) => run.searchEncodedBodyBytesAtHit)),
          searchFilesRequested: summarize(runs.map((run) => run.searchFilesRequested)),
          searchFilesCompletedAtHit: summarize(runs.map((run) => run.searchFilesCompletedAtHit)),
          searchDownloadElapsedMs: summarize(runs.map((run) => Math.max(...run.searchRequests.map((request) => request.finishedAt)) * 1000 - Math.min(...run.searchRequests.map((request) => request.started)) * 1000)),
          fullCorpusDownloadMsFromFocus: summarize(runs.map((run) => run.fullCorpusDownloadMsFromFocus)),
          progressiveUiCompleteMsFromFocus: servers[variant].progressive ? summarize(runs.map((run) => run.progressiveUiCompleteMsFromFocus)) : null,
          warmQueryUpdateMs: runs.every((run) => run.completePayload) ? summarize(runs.flatMap((run) => run.warmUpdates.map((update) => update.elapsedMs))) : null,
          failedRuns: 0, errors: 0,
        };
      }
    }
    report.status = "measured";
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
    console.error(error.message);
  } finally {
    await browser?.close();
    await Promise.all(Object.values(servers).map((server) => server.close()));
    report.environment.loadAverageEnd = loadavg();
    mkdirSync(dirname(resolve(reportPath)), { recursive: true });
    writeFileSync(reportPath, json(report));
    console.log(`Report ${resolve(reportPath)} has status ${report.status}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
