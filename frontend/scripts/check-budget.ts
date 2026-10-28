// Usage: node scripts/check-budget.ts [out dir]
// Fails when a page in quality-budget.json loads more bytes than its budget:
// its HTML plus the JS and CSS files that HTML references, raw and gzipped.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { basePath, loadBudget } from "./quality-budget.ts";

const out = process.argv[2] ?? join(import.meta.dirname, "..", "out");
const ASSET = /<(?:script|link)\b[^>]*?\s(?:src|href)="([^"]+\.(?:js|css))"/g;

function weigh(files: string[]) {
  const buffers = files.map((f) => readFileSync(f));
  return {
    bytes: buffers.reduce((n, b) => n + b.length, 0),
    gzip: buffers.reduce((n, b) => n + gzipSync(b).length, 0),
  };
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const rows: string[][] = [["page", "bytes", "budget", "gzip", "budget", ""]];
let failed = false;

for (const page of loadBudget().pages) {
  const html = join(out, page.path.split("?")[0]!, "index.html");
  if (!existsSync(html)) throw new Error(`${page.name}: ${html} is not in the build`);
  const assets = new Set<string>();
  for (const [, url] of readFileSync(html, "utf8").matchAll(ASSET)) {
    if (url!.startsWith(`${basePath}/`)) assets.add(join(out, decodeURIComponent(url!.slice(basePath.length))));
  }
  const used = weigh([html, ...assets]);
  const over = used.bytes > page.size.bytes || used.gzip > page.size.gzip;
  failed ||= over;
  rows.push([page.name, kb(used.bytes), kb(page.size.bytes), kb(used.gzip), kb(page.size.gzip), over ? "OVER" : "ok"]);
}

const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
for (const r of rows) {
  console.log(r.map((c, i) => (i === 0 || i === 5 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ").trimEnd());
}
if (failed) {
  console.error("A page is over its budget. Cut what it loads, or raise it in quality-budget.json and say why in the PR.");
  process.exit(1);
}
