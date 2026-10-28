import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { affectsPerformance, shouldRunLighthouse } from "./lighthouse-needed.mjs";

test("backend, CMS, docs and test-only changes skip Lighthouse", () => {
  const paths = ["backend/blog/api.py", "cms/src/editor.tsx", "docs/architecture/how-it-works.md",
    "frontend/README.md", "frontend/e2e/site.spec.ts", "frontend/test-fixtures/empty-site-data/manifest.json",
    "frontend/src/content/search.test.ts", "frontend/src/app/example.spec.tsx"];
  for (const path of paths) assert.equal(affectsPerformance(path), false, path);
  assert.equal(shouldRunLighthouse(paths), false);
});
test("rendering, styling, assets, build scripts, dependencies and budgets require Lighthouse", () => {
  for (const path of ["frontend/src/app/page.tsx", "frontend/src/app/globals.css", "frontend/src/content/markdown.ts",
    "frontend/public/icon.svg", "frontend/sample-site-data/articles/example.json", "frontend/scripts/render-diagrams.ts",
    "frontend/package.json", "frontend/package-lock.json", "frontend/next.config.ts", "frontend/tsconfig.json",
    "frontend/quality-budget.json", ".nvmrc", ".github/workflows/ci.yml", ".github/workflows/deploy.yml",
    ".github/scripts/lighthouse-needed.mjs"]) assert.equal(shouldRunLighthouse([path]), true, path);
});
test("mixed changes, deleted source paths and renames out of source still require the check", () => {
  assert.equal(shouldRunLighthouse(["docs/a.md", "frontend/src/app/removed.tsx"]), true);
  assert.equal(shouldRunLighthouse(["frontend/src/app/old.tsx", "docs/old.tsx"]), true);
});
test("manual override runs even with no relevant changes", () => {
  assert.equal(shouldRunLighthouse([]), false);
  assert.equal(shouldRunLighthouse(["backend/blog/api.py"], true), true);
  assert.equal(shouldRunLighthouse([], true), true);
});

const script = fileURLToPath(new URL("./lighthouse-needed.mjs", import.meta.url));

function withRepository(check) {
  const root = mkdtempSync(join(tmpdir(), "lighthouse-policy-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = () => {
    git("add", ".");
    git("-c", "user.name=CI test", "-c", "user.email=ci@example.invalid", "commit", "--allow-empty", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  };
  const run = (eventName, event, head, force = false) => {
    const eventPath = join(root, "event.json");
    const output = join(root, "output");
    writeFileSync(eventPath, JSON.stringify(event));
    writeFileSync(output, "");
    execFileSync(process.execPath, [script], { cwd: root, stdio: "pipe", env: {
      ...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath,
      GITHUB_SHA: head, FORCE_LIGHTHOUSE: String(force), GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: "",
    } });
    return readFileSync(output, "utf8");
  };
  try {
    git("init", "-q");
    check({ root, git, commit, run });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("CLI compares PR commits and skips docs-only changes", () => withRepository(({ root, commit, run }) => {
  const base = commit();
  writeFileSync(join(root, "README.md"), "docs only");
  const head = commit();
  assert.equal(run("pull_request", { pull_request: { base: { sha: base }, head: { sha: head } } }, head), "run=false\n");
}));

test("CLI compares main push commits and includes deleted source files", () => withRepository(({ root, git, commit, run }) => {
  mkdirSync(join(root, "frontend/src"), { recursive: true });
  writeFileSync(join(root, "frontend/src/page.tsx"), "old source");
  const base = commit();
  git("rm", "frontend/src/page.tsx");
  const head = commit();
  assert.equal(run("push", { before: base }, head), "run=true\n");
}));

test("CLI honors the manual checkbox and runs conservatively on missing history", () => withRepository(({ commit, run }) => {
  const head = commit();
  assert.equal(run("workflow_dispatch", {}, head, true), "run=true\n");
  assert.equal(run("workflow_dispatch", {}, head, false), "run=false\n");
  assert.equal(run("push", { before: "0".repeat(40) }, head), "run=true\n");
  assert.equal(run("pull_request", { pull_request: { base: { sha: "a".repeat(40) }, head: { sha: head } } }, head), "run=true\n");
}));
