import { createHash } from "node:crypto";
import type { SiteContent } from "./model.ts";
import { TIME_ZONE } from "../site.ts";
import { buildIndex } from "./search.ts";

export interface SearchAssets {
  metadataJson: string;
  chunks: ReadonlyMap<string, string>;
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const yearFormat = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric" });

export function buildSearchAssets(content: SiteContent): SearchAssets {
  const index = buildIndex(content);
  const groups = new Map<number, { docId: string; text: string }[]>();
  const docs = index.map(({ text, ...doc }) => {
    const year = Number(yearFormat.format(new Date(doc.publishedAt)));
    const group = groups.get(year) ?? [];
    group.push({ docId: doc.docId, text });
    groups.set(year, group);
    return { ...doc, text: text.slice(0, 160).replace(/[\ud800-\udbff]$/, "") };
  });
  const chunks = new Map<string, string>();
  const years = [...groups].map(([year, docs]) => {
    const json = JSON.stringify({ version: 2, year, docs });
    const asset = `${String(year).padStart(4, "0")}-${hash(json)}`;
    chunks.set(asset, json);
    return { year, asset };
  });
  return { metadataJson: JSON.stringify({ version: 2, docs, years }), chunks };
}
