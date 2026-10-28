import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The preview must render like the site, so both use the same parser, highlighter and diagram renderer.
// The site renders diagrams at build time, so mermaid is one of its devDependencies.
const SHARED = ["marked", "shiki", "mermaid"];

test("the CMS and the site pin the same versions of their shared renderers", () => {
  const deps = (path: string) => {
    const pkg = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
    return { ...pkg.dependencies, ...pkg.devDependencies };
  };
  const cms = deps("../package.json");
  const site = deps("../../frontend/package.json");
  for (const name of SHARED) assert.equal(cms[name], site[name], name);
});
