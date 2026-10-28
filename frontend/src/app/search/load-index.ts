import { prepareDoc, type PreparedSearchDoc, type SearchMetadata } from "../../content/search.ts";
import { BASE_PATH } from "../../site.ts";

type Available = {
  readonly docs: readonly PreparedSearchDoc[];
  readonly loadedYears: number;
  readonly totalYears: number;
};

export type SearchSnapshot =
  | { readonly phase: "idle"; readonly docs: readonly [] }
  | { readonly phase: "metadata-loading"; readonly docs: readonly [] }
  | { readonly phase: "metadata-error"; readonly docs: readonly []; readonly message: string }
  | (Available & { readonly phase: "bodies" | "complete" })
  | (Available & { readonly phase: "body-error"; readonly failedYear: number; readonly message: string });

type Year = { year: number; asset: string };
type Metadata = { docs: PreparedSearchDoc[]; years: Year[]; positions: Map<string, number> };
type MetadataJson = { version: number; docs: (SearchMetadata & { text: string })[]; years: Year[] };
type ChunkJson = { docs: { docId: string; text: string }[] };
const IDLE: SearchSnapshot = { phase: "idle", docs: [] };

// The metadata is fetched fresh, so a tab opened before a deploy can meet a newer format.
function readMetadata(data: MetadataJson): Metadata {
  if (data.version !== 2) throw new Error("搜尋資料格式不符，請重新載入頁面。");
  const docs = data.docs.map(({ text, ...doc }) => prepareDoc(doc, text));
  return { docs, years: data.years, positions: new Map(docs.map((d, i) => [d.doc.docId, i])) };
}

function readChunk(data: ChunkJson, docs: readonly PreparedSearchDoc[], positions: Map<string, number>): PreparedSearchDoc[] {
  const next = docs.slice();
  for (const { docId, text } of data.docs) {
    const position = positions.get(docId)!;
    next[position] = { ...next[position], text, textKey: text.toLowerCase() };
  }
  return next;
}

export function createSearchStore(fetcher: typeof fetch = (...args) => fetch(...args), basePath = BASE_PATH) {
  let snapshot = IDLE;
  let metadata: Metadata | undefined;
  let docs: readonly PreparedSearchDoc[] = [];
  let cursor = 0;
  let active: Promise<void> | undefined;
  const listeners = new Set<() => void>();

  function publish(next: SearchSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function available(): Available {
    return { docs, loadedYears: cursor, totalYears: metadata!.years.length };
  }

  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetcher(`${basePath}${path}`, options);
    if (!response.ok) throw new Error("無法下載搜尋資料。");
    return response.json();
  }

  async function run() {
    try {
      if (!metadata) {
        publish({ phase: "metadata-loading", docs: [] });
        metadata = readMetadata(await request<MetadataJson>("/search-metadata.json", { cache: "no-store" }));
        docs = metadata.docs;
      }
      publish({ phase: cursor === metadata.years.length ? "complete" : "bodies", ...available() });
      while (cursor < metadata.years.length) {
        const year = metadata.years[cursor];
        docs = readChunk(await request<ChunkJson>(`/search-data/${year.asset}/chunk.json`), docs, metadata.positions);
        cursor++;
        publish({ phase: cursor === metadata.years.length ? "complete" : "bodies", ...available() });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "無法下載搜尋資料。";
      publish(metadata
        ? { phase: "body-error", ...available(), failedYear: metadata.years[cursor].year, message }
        : { phase: "metadata-error", docs: [], message });
    }
  }

  return {
    subscribeSearch(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSearchSnapshot: () => snapshot,
    getServerSearchSnapshot: () => IDLE,
    startSearch(): Promise<void> {
      if (snapshot.phase === "complete") return Promise.resolve();
      active ??= Promise.resolve().then(run).finally(() => { active = undefined; });
      return active;
    },
  };
}

export const { subscribeSearch, getSearchSnapshot, getServerSearchSnapshot, startSearch } = createSearchStore();
