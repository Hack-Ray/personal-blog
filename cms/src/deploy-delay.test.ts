import assert from "node:assert/strict";
import { test } from "node:test";
import type { Release } from "./api.ts";
import { isSlow } from "./deploy-delay.ts";

const now = new Date("2026-10-22T12:00:00Z");
const release = (status: Release["status"], created_at: string) => ({ status, created_at }) as Release;

test("a pending release is slow from exactly 10 minutes on", () => {
  assert.equal(isSlow([release("dispatched", "2026-10-22T11:50:00Z")], now), true);
  assert.equal(isSlow([release("building", "2026-10-22T11:50:01Z")], now), false);
  assert.equal(isSlow([release("building", "2026-10-22T11:00:00Z")], now), true);
});

test("a release that is not pending is never slow", () => {
  for (const status of ["deployed", "failed", "superseded", "pushed", "dispatch_failed"] as const) {
    assert.equal(isSlow([release(status, "2026-10-21T00:00:00Z")], now), false);
  }
});

test("no releases are not slow", () => {
  assert.equal(isSlow([], now), false);
});
