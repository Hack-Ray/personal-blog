import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SiteContent } from "./model.ts";
import { parseSiteContent } from "./parse.ts";

// Until the FastAPI export exists, the build reads a local fixture.
const CONTENT_FILE = join(process.cwd(), "content", "site.json");

let cached: SiteContent | undefined;

export function loadSiteContent(): SiteContent {
  cached ??= parseSiteContent(JSON.parse(readFileSync(CONTENT_FILE, "utf8")));
  return cached;
}
