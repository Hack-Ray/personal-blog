import type { SearchDoc } from "../../content/search.ts";
import { BASE_PATH } from "../../site.ts";

let pending: Promise<SearchDoc[]> | undefined;

/** Fetched once per page load and shared by the header dropdown and the search page. */
export function loadIndex(): Promise<SearchDoc[]> {
  pending ??= fetch(`${BASE_PATH}/search-index.json`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  pending.catch(() => (pending = undefined));
  return pending;
}
