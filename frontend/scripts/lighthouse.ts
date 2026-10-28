// Usage: node scripts/lighthouse.ts [report dir]
// Serves out/, runs Lighthouse (mobile preset) on each page in quality-budget.json
// `runs` times, and fails when a category's median score is under its minimum.
// The HTML and JSON report of each page's median-performance run go to the
// report dir (default lighthouse-reports/).
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import lighthouse from "lighthouse";
import { basePath, loadBudget, type Category } from "./quality-budget.ts";

const PORT = 8125;
const DEBUG_PORT = 9223;
const CATEGORIES: Category[] = ["performance", "accessibility", "best-practices", "seo"];
const reportDir = process.argv[2] ?? join(import.meta.dirname, "..", "lighthouse-reports");
const origin = `http://127.0.0.1:${PORT}${basePath}/`;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function up(url: string) {
  for (let i = 0; i < 30; i++) {
    if ((await fetch(url).catch(() => undefined))?.ok) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} did not come up`);
}

const server = spawn("sh", [join(import.meta.dirname, "serve-out.sh"), String(PORT)], { stdio: "ignore" });
const browser = await chromium.launch({ args: [`--remote-debugging-port=${DEBUG_PORT}`] });
const { pages, lighthouse: budget } = loadBudget();
mkdirSync(reportDir, { recursive: true });

const rows: string[][] = [["page", ...CATEGORIES, "performance runs", ""]];
let failed = false;
try {
  await up(origin);
  for (const page of pages) {
    const runs: { scores: Record<Category, number>; json: string; html: string }[] = [];
    for (let i = 0; i < budget.runs; i++) {
      const result = await lighthouse(origin + page.path, { port: DEBUG_PORT, output: ["json", "html"], logLevel: "error", blockedUrlPatterns: ["https://giscus.app/*"] });
      if (!result) throw new Error(`${page.name}: Lighthouse returned nothing`);
      const [json, html] = result.report as string[];
      const score = (c: Category) => result.lhr.categories[c]!.score ?? 0;
      runs.push({ scores: Object.fromEntries(CATEGORIES.map((c) => [c, score(c)])) as Record<Category, number>, json: json!, html: html! });
    }
    const keep = [...runs].sort((a, b) => a.scores.performance - b.scores.performance)[Math.floor(runs.length / 2)]!;
    writeFileSync(join(reportDir, `${page.name}.json`), keep.json);
    writeFileSync(join(reportDir, `${page.name}.html`), keep.html);
    const medians = Object.fromEntries(CATEGORIES.map((c) => [c, median(runs.map((r) => r.scores[c]))])) as Record<Category, number>;
    const min = { ...budget.minScores, ...page.minScores };
    const low = CATEGORIES.filter((c) => medians[c] < min[c]);
    failed ||= low.length > 0;
    rows.push([page.name, ...CATEGORIES.map((c) => `${Math.round(medians[c] * 100)} (min ${Math.round(min[c] * 100)})`), runs.map((r) => Math.round(r.scores.performance * 100)).join("/"), low.length ? `LOW: ${low.join(", ")}` : "ok"]);
  }
} finally {
  await browser.close();
  server.kill();
}

const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
console.log(`Lighthouse mobile, median of ${budget.runs} runs; reports in ${reportDir}`);
for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd());
if (failed) process.exit(1);
