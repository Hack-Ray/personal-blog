// Usage: node scripts/check-links.ts [out dir]
// Fails when a built page links to, or loads, a site path that has no file in
// the build. Absolute paths outside the basePath count as broken, since GitHub
// Pages serves the site only under it. Links to other sites are not checked.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const out = process.argv[2] ?? join(import.meta.dirname, "..", "out");
const basePath = process.env.BASE_PATH ?? "/personal-blog";
const ATTR = /\s(?:href|src)="([^"]*)"/g;

function* htmlFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* htmlFiles(path);
    else if (name.endsWith(".html")) yield path;
  }
}

/** The build file a site path is served from, or undefined if there is none. */
function servedFile(outDir: string, path: string, base: string): string | undefined {
  if (path !== base && !path.startsWith(`${base}/`)) return undefined;
  const file = join(outDir, decodeURIComponent(path.slice(base.length)));
  const candidates = path.endsWith("/") ? [join(file, "index.html")] : [file, join(file, "index.html")];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile());
}

const broken: string[] = [];
let checked = 0;
for (const page of htmlFiles(out)) {
  for (const [, raw] of readFileSync(page, "utf8").matchAll(ATTR)) {
    const url = raw!.replace(/&amp;/g, "&");
    if (!url.startsWith("/") || url.startsWith("//")) continue;
    const path = url.split(/[?#]/)[0]!;
    checked++;
    if (!servedFile(out, path || "/", basePath)) broken.push(`${relative(out, page)}: ${url}`);
  }
}
for (const b of [...new Set(broken)]) console.error(`broken: ${b}`);
console.log(`checked ${checked} links, ${new Set(broken).size} broken`);
if (broken.length > 0) process.exit(1);
