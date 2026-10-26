import assert from "node:assert/strict";
import { test } from "node:test";
import type { SourceStatus } from "./api.ts";
import {
  daysBetween,
  formatBytes,
  formatDay,
  formatPercent,
  formatPosition,
  linePath,
  nearestIndex,
  niceTicks,
  pagePath,
  seriesFor,
  shouldAutoSync,
} from "./analytics.ts";

const source = (configured: boolean, stale: boolean): SourceStatus => ({
  source: "cloudflare",
  configured,
  stale,
  synced_at: null,
  attempted_at: null,
  error: null,
});

test("the page syncs on open only when a configured source is stale", () => {
  assert.equal(shouldAutoSync([source(true, true), source(false, false)]), true);
  assert.equal(shouldAutoSync([source(true, false), source(true, false)]), false);
  assert.equal(shouldAutoSync([source(false, false), source(false, false)]), false);
});

test("bytes are shown in binary units", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1536), "1.50 KB");
  assert.equal(formatBytes(250 * 1024 * 1024), "250.0 MB");
  assert.equal(formatBytes(3 * 1024 ** 4), "3.00 TB");
});

test("ratios and positions read as a dash when there is nothing to divide", () => {
  assert.equal(formatPercent(0.75), "75.0%");
  assert.equal(formatPercent(0.0123), "1.2%");
  assert.equal(formatPercent(null), "—");
  assert.equal(formatPosition(8), "8.0");
  assert.equal(formatPosition(null), "—");
});

test("days are labelled as the UTC day the backend means", () => {
  assert.equal(formatDay("2026-01-05"), "1/5");
  assert.deepEqual(daysBetween("2026-02-27", "2026-03-02"), ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  assert.equal(daysBetween("2026-01-01", "2026-03-31").length, 90);
});

test("a day without data is a gap, not a zero", () => {
  const days = ["2026-10-01", "2026-10-02", "2026-10-03"];
  assert.deepEqual(
    seriesFor(days, [{ day: "2026-10-01", n: 0 }, { day: "2026-10-03", n: 7 }], (r) => r.n),
    [0, null, 7],
  );
});

test("axis ticks are round and reach the largest value", () => {
  assert.deepEqual(niceTicks(0), [0, 1]);
  assert.deepEqual(niceTicks(3), [0, 1, 2, 3]);
  assert.deepEqual(niceTicks(87), [0, 25, 50, 75, 100]);
  assert.deepEqual(niceTicks(1200), [0, 500, 1000, 1500]);
  for (const max of [1, 9, 42, 999, 123456]) {
    const ticks = niceTicks(max);
    assert.ok(ticks.at(-1)! >= max && ticks.length <= 6 && ticks.every(Number.isInteger), `${max}: ${ticks}`);
  }
});

test("a line breaks at missing days and a lone day still shows", () => {
  const x = (i: number) => i * 10;
  const y = (v: number) => 100 - v;
  assert.equal(linePath([1, 2, 3], x, y), "M0 99L10 98L20 97");
  assert.equal(linePath([1, 2, null, 4, 5], x, y), "M0 99L10 98M30 96L40 95");
  assert.equal(linePath([null, 6, null], x, y), "M10 94h0");
  assert.equal(linePath([null, null], x, y), "");
});

test("the pointer snaps to the nearest day", () => {
  assert.equal(nearestIndex(0, 300, 4), 0);
  assert.equal(nearestIndex(149, 300, 4), 1);
  assert.equal(nearestIndex(151, 300, 4), 2);
  assert.equal(nearestIndex(-20, 300, 4), 0);
  assert.equal(nearestIndex(500, 300, 4), 3);
  assert.equal(nearestIndex(42, 300, 1), 0);
});

test("pages are listed by their path", () => {
  assert.equal(pagePath("https://example.com/posts/01ABC/"), "/posts/01ABC/");
  assert.equal(pagePath("https://example.com/tags/%E4%B8%AD%E6%96%87/"), "/tags/中文/");
  assert.equal(pagePath("not a url"), "not a url");
});
