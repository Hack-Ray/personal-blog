// Only Lighthouse is conditional; the other frontend checks always run.
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function affectsPerformance(path) {
  if ([".nvmrc", ".github/workflows/ci.yml", ".github/workflows/deploy.yml",
       ".github/scripts/lighthouse-needed.mjs"].includes(path)) return true;
  if (/^frontend\/(?:public|sample-site-data|scripts)\//.test(path)) return true;
  if (/^frontend\/src\//.test(path)) return !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
  return /^frontend\/(?:package(?:-lock)?\.json|next\.config\.[cm]?[jt]s|tsconfig\.json|quality-budget\.json)$/.test(path);
}

export function shouldRunLighthouse(paths, force = false) {
  return force || paths.some(affectsPerformance);
}

function decide() {
  if (process.env.FORCE_LIGHTHOUSE === "true") return { run: true, reason: "Manually requested" };
  if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch") return { run: false, reason: "Manual Lighthouse option is off" };
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const base = event.pull_request?.base.sha ?? event.before;
    const head = event.pull_request?.head.sha ?? process.env.GITHUB_SHA;
    if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha ?? "") && !/^0+$/.test(sha))) {
      throw new Error("Missing comparison commit");
    }
    for (const ref of new Set([base, head])) {
      try {
        execFileSync("git", ["cat-file", "-e", ref + "^{commit}"], { stdio: "pipe" });
      } catch {
        execFileSync("git", ["fetch", "--no-tags", "--depth=1", "origin", ref], { stdio: "pipe" });
      }
    }
    // Include both names of a rename and deleted paths. Compare immutable commits,
    // not branch names; the same policy works for PRs and deploy.yml's main push.
    const paths = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", base, head], { encoding: "utf8" }).split("\0").filter(Boolean);
    const run = shouldRunLighthouse(paths);
    return { run, reason: run ? "Performance-relevant files changed" : "No performance-relevant files changed" };
  } catch (error) {
    // Never silently miss a regression when Git history or the event is unavailable.
    console.warn("Cannot determine changed paths; running Lighthouse:", error.message);
    return { run: true, reason: "Comparison unavailable; check conservatively" };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { run, reason } = decide();
  appendFileSync(process.env.GITHUB_OUTPUT, "run=" + run + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "Lighthouse: **" + (run ? "run" : "skip") + "** — " + reason + ".\n");
  console.log("Lighthouse: " + (run ? "run" : "skip") + " — " + reason);
}
