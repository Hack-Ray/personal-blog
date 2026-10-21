import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SiteContent } from "./model.ts";
import { ContentError, parseSnapshot } from "./parse.ts";

// CI checks out the private content repo and points SITE_DATA_DIR at it.
export const SITE_DATA_DIR = resolve(process.env.SITE_DATA_DIR ?? "sample-site-data");

function readJson(path: string): unknown {
  if (!existsSync(path)) throw new ContentError(`${path}: file not found`);
  return JSON.parse(readFileSync(path, "utf8"));
}

let cached: SiteContent | undefined;

export function loadSiteContent(): SiteContent {
  cached ??= parseSnapshot({
    manifest: readJson(join(SITE_DATA_DIR, "manifest.json")),
    profile: existsSync(join(SITE_DATA_DIR, "profile.json")) ? readJson(join(SITE_DATA_DIR, "profile.json")) : undefined,
    readArticle: (docId) => readJson(join(SITE_DATA_DIR, "articles", `${docId}.json`)),
    hasImage: (name) => !name.includes("/") && statSync(join(SITE_DATA_DIR, "images", name), { throwIfNoEntry: false })?.isFile() === true,
  });
  return cached;
}
