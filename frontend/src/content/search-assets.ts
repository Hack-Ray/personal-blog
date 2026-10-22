import { createHash } from "node:crypto";
import type { SiteContent } from "./model.ts";
import { buildIndex } from "./search.ts";

export interface SearchAssets {
  metadataJson: string;
  chunks: ReadonlyMap<string, string>;
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export function buildSearchAssets(content: SiteContent): SearchAssets {
  const index = buildIndex(content);
  const groups = new Map<number, { docId: string; textKey: string }[]>();
  const docs = index.map(({ text, ...doc }) => {
    const year = new Date(doc.publishedAt).getUTCFullYear();
    const textKey = text.toLowerCase();
    const group = groups.get(year) ?? [];
    group.push({ docId: doc.docId, textKey });
    groups.set(year, group);
    return { ...doc, textKey: textKey.slice(0, 160) };
  });
  const chunks = new Map<string, string>();
  const years = [...groups].map(([year, docs]) => {
    const json = JSON.stringify({ version: 1, year, docs });
    const asset = `${String(year).padStart(4, "0")}-${hash(json)}`;
    chunks.set(asset, json);
    return { year, asset, docIds: docs.map((doc) => doc.docId) };
  });
  const revision = hash(JSON.stringify({ docs, years }));
  return { metadataJson: JSON.stringify({ version: 1, revision, docs, years }), chunks };
}
