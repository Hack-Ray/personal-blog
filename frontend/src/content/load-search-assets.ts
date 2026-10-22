import { loadSiteContent } from "./load.ts";
import { buildSearchAssets, type SearchAssets } from "./search-assets.ts";

let cached: SearchAssets | undefined;

export function loadSearchAssets(): SearchAssets {
  return cached ??= buildSearchAssets(loadSiteContent());
}
