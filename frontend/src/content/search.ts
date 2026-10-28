import type { SiteContent } from "./model.ts";
import { postPath, published } from "./queries.ts";
import { plainText } from "./summary.ts";

export interface SearchMetadata {
  docId: string;
  path: string;
  title: string;
  topic: string;
  tags: string[];
  publishedAt: string;
}

export interface SearchDoc extends SearchMetadata {
  text: string;
}

export interface PreparedSearchDoc {
  doc: SearchMetadata;
  text: string;
  titleKey: string;
  taxaKey: string;
  textKey: string;
}

interface SearchHit {
  doc: SearchMetadata;
  prepared: PreparedSearchDoc;
  score: number;
}

const TEXT_LIMIT = 5000;
// A term found in the title outranks one found in the topic or tags, which
// outranks one found only in the body.
const WEIGHT = { title: 10, taxon: 5, text: 1 };
const SNIPPET_LENGTH = 120;
const SNIPPET_LEAD = 30;
const PHRASE_BREAK = /([\s，。、；：！？「」『』（）《》〈〉…—]+)/u;
const LEADING_BREAK = /^[\s，。、；：！？」』）》〉…—]+/u;

// Body text keeps each phrase once, with the separator that followed it, so a snippet reads
// like the original minus repeats.
function distinctPhrases(text: string) {
  const parts = text.split(PHRASE_BREAK);
  const seen = new Set<string>();
  let out = "";
  for (let i = 0; i < parts.length; i += 2) {
    if (!parts[i] || seen.has(parts[i])) continue;
    seen.add(parts[i]);
    out += parts[i] + (parts[i + 1] ?? "").replace(/\s+/g, " ");
  }
  return out.trimEnd();
}

export function buildIndex(content: SiteContent): SearchDoc[] {
  return published(content).map((a) => ({
    docId: a.docId,
    path: postPath(a),
    title: a.title,
    topic: a.topic.name,
    tags: a.tags.map((t) => t.name),
    publishedAt: a.publishedAt.toISOString(),
    text: distinctPhrases([a.excerpt, plainText(a.markdown)].filter(Boolean).join(" ").slice(0, TEXT_LIMIT)),
  }));
}

export function prepareDoc(doc: SearchMetadata, text: string): PreparedSearchDoc {
  return { doc, text, titleKey: doc.title.toLowerCase(), taxaKey: [doc.topic, ...doc.tags].join(" ").toLowerCase(), textKey: text.toLowerCase() };
}

export function prepareIndex(index: readonly SearchDoc[]): PreparedSearchDoc[] {
  return index.map(({ text, ...doc }) => prepareDoc(doc, text));
}

export const terms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** Every term must match somewhere; results are best first, then newest. */
export function search(index: readonly PreparedSearchDoc[], query: string): SearchHit[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const prepared of index) {
    const { doc, titleKey: title, taxaKey: taxa, textKey: text } = prepared;
    let score = 0;
    for (const term of wanted) {
      const s = (title.includes(term) ? WEIGHT.title : 0) + (taxa.includes(term) ? WEIGHT.taxon : 0) + (text.includes(term) ? WEIGHT.text : 0);
      if (s === 0) {
        score = 0;
        break;
      }
      score += s;
    }
    if (score > 0) hits.push({ doc, prepared, score });
  }
  return hits.sort((a, b) => b.score - a.score || b.doc.publishedAt.localeCompare(a.doc.publishedAt));
}

export interface Segment {
  text: string;
  mark: boolean;
}

// Lowercasing can change length (İ); then positions in the lowercase key don't map onto the
// original, so the key itself is shown.
const displayed = (text: string, key: string) => (key.length === text.length ? text : key);

function marked(text: string, key: string, wanted: readonly string[]): Segment[] {
  const found: [number, number][] = [];
  for (const term of wanted) {
    for (let i = key.indexOf(term); i >= 0; i = key.indexOf(term, i + 1)) found.push([i, i + term.length]);
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of found) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  const shown = displayed(text, key);
  const segments: Segment[] = [];
  let at = 0;
  for (const [start, end] of merged) {
    if (start > at) segments.push({ text: shown.slice(at, start), mark: false });
    segments.push({ text: shown.slice(start, end), mark: true });
    at = end;
  }
  if (at < shown.length) segments.push({ text: shown.slice(at), mark: false });
  return segments;
}

export function highlight(text: string, wanted: readonly string[]): Segment[] {
  return marked(text, text.toLowerCase(), wanted);
}

const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** The body around the first match, or its start when only the title or taxa matched. */
export function snippet({ text, textKey }: PreparedSearchDoc, wanted: readonly string[]): Segment[] {
  const shown = displayed(text, textKey);
  const first = Math.min(...wanted.map((term) => textKey.indexOf(term)).filter((i) => i >= 0));
  let start = Number.isFinite(first) ? Math.max(0, first - SNIPPET_LEAD) : 0;
  let end = Math.min(shown.length, start + SNIPPET_LENGTH);
  if (start > 0 && isLow(shown.charCodeAt(start))) start++;
  if (end < shown.length && isHigh(shown.charCodeAt(end - 1))) end--;
  if (start > 0) start += LEADING_BREAK.exec(shown.slice(start, first))?.[0].length ?? 0;
  const cut = shown.slice(start, end);
  return [
    ...(start > 0 ? [{ text: "…", mark: false }] : []),
    ...highlight(cut, wanted),
    ...(end < shown.length ? [{ text: "…", mark: false }] : []),
  ];
}
