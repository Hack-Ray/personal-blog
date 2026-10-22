import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cacheControl, MUTABLE_CACHE, securityHeaders } from "../src/content/cdn-headers.ts";

const out = process.argv[2] ?? join(import.meta.dirname, "..", "out");
const basePath = process.env.BASE_PATH ?? "/personal-blog";
const entries: { path: string; headers: Record<string, string> }[] = [];

function visit(dir: string): void {
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) { visit(file); continue; }
    const rel = relative(out, file).replaceAll("\\", "/");
    if (rel === "cdn-headers.json") continue;
    const headers: Record<string, string> = { "Cache-Control": cacheControl(rel) };
    if (rel.endsWith(".html")) Object.assign(headers, securityHeaders(readFileSync(file, "utf8")));
    const path = `${basePath}/${rel}`;
    entries.push({ path, headers });
    if (rel.endsWith("index.html")) entries.push({ path: path.slice(0, -"index.html".length), headers });
  }
}

visit(out);
if (!entries.some((e) => e.path.endsWith("/index.html"))) throw new Error("No built index.html; run the Next.js build first");
writeFileSync(join(out, "cdn-headers.json"), JSON.stringify({
  schema_version: 1,
  default_headers: { "Cache-Control": MUTABLE_CACHE },
  entries,
}, null, 2) + "\n");
console.log(`Prepared CDN response headers for ${entries.length} paths; GitHub Pages does not apply this file.`);
