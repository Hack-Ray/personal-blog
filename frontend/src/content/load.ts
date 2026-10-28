import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SiteContent } from "./model.ts";
import { ContentError, parseSnapshot } from "./parse.ts";

// CI checks out the private content repo and points SITE_DATA_DIR at it.
export const SITE_DATA_DIR = resolve(process.env.SITE_DATA_DIR ?? "sample-site-data");

/** Intrinsic sizes of the snapshot images, keyed by images/<file>; written by scripts/copy-snapshot-images.ts, outside public/ so it is not deployed. */
export const IMAGE_SIZES_FILE = resolve(".generated/image-sizes.json");

/** The snapshot's Mermaid diagrams as SVG, keyed by diagramKey; written by scripts/render-diagrams.ts. */
export const DIAGRAMS_FILE = resolve(".generated/diagrams.json");

function readJson(path: string): unknown {
  if (!existsSync(path)) throw new ContentError(`${path}: file not found`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new ContentError(`${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
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
