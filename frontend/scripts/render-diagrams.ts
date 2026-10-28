// Usage: node scripts/render-diagrams.ts [--needs-browser]
// Renders the snapshot's Mermaid blocks to SVG in headless Chromium, so pages
// ship no Mermaid script (FE-022). --needs-browser only prints whether the
// snapshot has any, for the deploy workflow to skip installing Chromium.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { type DiagramTheme, diagramSvg, diagramTitle, mermaidConfig, mermaidSources } from "../src/content/article-syntax.ts";
import { type Diagrams, diagramId, diagramKey } from "../src/content/diagrams.ts";
import { DIAGRAMS_FILE, loadSiteContent } from "../src/content/load.ts";

const { articles, profile } = loadSiteContent();
const sources = new Map<string, { source: string; where: string }>();
const collect = (markdown: string, where: string) => {
  for (const source of mermaidSources(markdown)) {
    const key = diagramKey(source);
    if (!sources.has(key)) sources.set(key, { source, where });
  }
};
for (const a of articles) if (a.state === "published") collect(a.markdown, `articles/${a.docId}.json (${a.title})`);
collect(profile.intro, "profile.json");

if (process.argv.includes("--needs-browser")) {
  console.log(sources.size > 0);
  process.exit(0);
}

rmSync(DIAGRAMS_FILE, { force: true });
const diagrams: Diagrams = {};
if (sources.size > 0) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ path: createRequire(import.meta.url).resolve("mermaid/dist/mermaid.min.js") });
    for (const [key, { source, where }] of sources) {
      const svg = async (theme: DiagramTheme) => {
        const out = await page.evaluate(
          async ({ id, source, config }) => {
            const mermaid = (globalThis as unknown as { mermaid: typeof import("mermaid").default }).mermaid;
            mermaid.initialize(config);
            try {
              return { svg: (await mermaid.render(id, source)).svg };
            } catch (e) {
              return { error: e instanceof Error ? e.message : String(e) };
            }
          },
          { id: diagramId(key, theme), source, config: mermaidConfig(theme) },
        );
        if ("error" in out) throw new Error(`${where}: Mermaid diagram failed to render:\n${out.error}`);
        try {
          return diagramSvg(out.svg, diagramTitle(source));
        } catch (e) {
          throw new Error(`${where}: Mermaid diagram cannot be shown: ${(e as Error).message}`);
        }
      };
      diagrams[key] = { light: await svg("light"), dark: await svg("dark") };
    }
  } finally {
    await browser.close();
  }
}
mkdirSync(dirname(DIAGRAMS_FILE), { recursive: true });
writeFileSync(DIAGRAMS_FILE, JSON.stringify(diagrams));
console.log(`rendered ${sources.size} Mermaid diagram${sources.size === 1 ? "" : "s"}`);
