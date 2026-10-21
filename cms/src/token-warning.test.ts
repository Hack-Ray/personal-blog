import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenWarning } from "./token-warning.ts";

const now = new Date("2027-01-01T00:00:00Z");

test("no warning without an expiry date or more than 30 days ahead", () => {
  assert.equal(tokenWarning(null, now), "");
  assert.equal(tokenWarning("2027-02-01T00:00:00Z", now), "");
});

test("warns within 30 days and once expired", () => {
  assert.match(tokenWarning("2027-01-18T00:00:00Z", now), /將在 17 天後/);
  assert.match(tokenWarning("2026-12-31T00:00:00Z", now), /已過期/);
});
