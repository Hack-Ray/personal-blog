import { prepareDoc, type PreparedSearchDoc } from "../../content/search.ts";
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

type Year = { year: number; asset: string; docIds: string[] };
type Metadata = { docs: PreparedSearchDoc[]; years: Year[]; positions: Map<string, number> };
const IDLE: SearchSnapshot = { phase: "idle", docs: [] };
const INVALID = "搜尋資料格式不符，請重新載入頁面。";

function check(condition: unknown): asserts condition {
  if (!condition) throw new Error(INVALID);
}

function record(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function normalized(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit && value === value.toLowerCase();
}

function readMetadata(value: unknown): Metadata {
  const data = record(value);
  check(data.version === 1 && typeof data.revision === "string" && /^[a-f0-9]{64}$/.test(data.revision));
  check(Array.isArray(data.docs) && Array.isArray(data.years));
  const positions = new Map<string, number>();
  const docs = data.docs.map((value, position) => {
    const doc = record(value);
    check(typeof doc.docId === "string" && doc.docId.length > 0 && !positions.has(doc.docId));
    check(typeof doc.title === "string" && typeof doc.topic === "string" && strings(doc.tags));
    check(typeof doc.publishedAt === "string" && Number.isFinite(Date.parse(doc.publishedAt)));
    check(new Date(doc.publishedAt).toISOString() === doc.publishedAt && normalized(doc.textKey, 160));
    positions.set(doc.docId, position);
    return prepareDoc({ docId: doc.docId, title: doc.title, topic: doc.topic, tags: doc.tags, publishedAt: doc.publishedAt }, doc.textKey);
  });
  const assigned = new Set<string>();
  let previous = Infinity;
  const years = data.years.map((value) => {
    const year = record(value);
    check(typeof year.year === "number" && Number.isInteger(year.year) && year.year < previous);
    check(typeof year.asset === "string" && new RegExp(`^${String(year.year).padStart(4, "0")}-[a-f0-9]{64}$`).test(year.asset));
    check(strings(year.docIds) && year.docIds.length > 0);
    previous = year.year;
    for (const id of year.docIds) {
      const position = positions.get(id);
      check(position !== undefined && !assigned.has(id));
      check(new Date(docs[position].doc.publishedAt).getUTCFullYear() === year.year);
      assigned.add(id);
    }
    return { year: year.year, asset: year.asset, docIds: year.docIds };
  });
  check(assigned.size === docs.length);
  return { docs, years, positions };
}

function readChunk(value: unknown, year: Year, docs: readonly PreparedSearchDoc[], positions: Map<string, number>): PreparedSearchDoc[] {
  const data = record(value);
  check(data.version === 1 && data.year === year.year && Array.isArray(data.docs) && data.docs.length === year.docIds.length);
  const remaining = new Set(year.docIds);
  const updates = data.docs.map((value) => {
    const entry = record(value);
    check(typeof entry.docId === "string" && remaining.delete(entry.docId));
    // Lowercasing can expand a bounded 5,000-unit source, for example U+0130.
    check(normalized(entry.textKey, 15000));
    const position = positions.get(entry.docId)!;
    check(entry.textKey.startsWith(docs[position].textKey));
    return { position, doc: { ...docs[position], textKey: entry.textKey } };
  });
  const next = docs.slice();
  for (const { position, doc } of updates) next[position] = doc;
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

  async function request(path: string, options?: RequestInit): Promise<unknown> {
    const response = await fetcher(`${basePath}${path}`, options);
    if (!response.ok) throw new Error("無法下載搜尋資料。");
    return response.json();
  }

  async function run() {
    try {
      if (!metadata) {
        publish({ phase: "metadata-loading", docs: [] });
        metadata = readMetadata(await request("/search-metadata.json", { cache: "no-store" }));
        docs = metadata.docs;
      }
      publish({ phase: cursor === metadata.years.length ? "complete" : "bodies", ...available() });
      while (cursor < metadata.years.length) {
        const year = metadata.years[cursor];
        const chunk = await request(`/search-data/${year.asset}/chunk.json`);
        docs = readChunk(chunk, year, docs, metadata.positions);
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
