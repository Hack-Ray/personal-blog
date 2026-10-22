import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The preview must render like the site, so both use the same parser and highlighter.
const SHARED = ["marked", "shiki"];

test("the CMS and the site pin the same versions of their shared renderers", () => {
  const deps = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")).dependencies;
  const cms = deps("../package.json");
  const site = deps("../../frontend/package.json");
  for (const name of SHARED) assert.equal(cms[name], site[name], name);
});
