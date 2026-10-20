import assert from "node:assert/strict";
import { test } from "node:test";
import { profile } from "./profile.ts";

test("profile links use https or mailto", () => {
  for (const { label, url } of [...profile.links, ...profile.projects.flatMap((p) => (p.url ? [{ label: p.name, url: p.url }] : []))]) {
    assert.match(url, /^(https:\/\/|mailto:)/, `${label}: ${url}`);
  }
});

test("profile has a name", () => {
  assert.ok(profile.name.trim());
});
