import type { SiteContent } from "./model.ts";
import { published } from "./queries.ts";
import { plainText } from "./summary.ts";

export interface SearchMetadata {
  docId: string;
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
  titleKey: string;
  taxaKey: string;
  textKey: string;
}

export interface SearchHit {
  doc: SearchMetadata;
  score: number;
}

const TEXT_LIMIT = 5000;
// A term found in the title outranks one found in the topic or tags, which
// outranks one found only in the body.
const WEIGHT = { title: 10, taxon: 5, text: 1 };
// Body text is kept as its distinct phrases. A query term has no whitespace, so
// splitting there loses no match; splitting at CJK punctuation loses only terms
// that contain it.
const PHRASE_BREAK = /[\s，。、；：！？「」『』（）《》〈〉…—]+/u;

const distinctPhrases = (text: string) => [...new Set(text.split(PHRASE_BREAK).filter(Boolean))].join(" ");

export function buildIndex(content: SiteContent): SearchDoc[] {
  return published(content).map((a) => ({
    docId: a.docId,
    title: a.title,
    topic: a.topic.name,
    tags: a.tags.map((t) => t.name),
    publishedAt: a.publishedAt.toISOString(),
    text: distinctPhrases([a.excerpt, plainText(a.markdown)].filter(Boolean).join(" ").slice(0, TEXT_LIMIT)),
  }));
}

export function prepareDoc(doc: SearchMetadata, textKey: string): PreparedSearchDoc {
  return { doc, titleKey: doc.title.toLowerCase(), taxaKey: [doc.topic, ...doc.tags].join(" ").toLowerCase(), textKey };
}

export function prepareIndex(index: readonly SearchDoc[]): PreparedSearchDoc[] {
  return index.map(({ text, ...doc }) => prepareDoc(doc, text.toLowerCase()));
}

const terms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** Every term must match somewhere; results are best first, then newest. */
export function search(index: readonly PreparedSearchDoc[], query: string): SearchHit[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const { doc, titleKey: title, taxaKey: taxa, textKey: text } of index) {
    let score = 0;
    for (const term of wanted) {
      const s = (title.includes(term) ? WEIGHT.title : 0) + (taxa.includes(term) ? WEIGHT.taxon : 0) + (text.includes(term) ? WEIGHT.text : 0);
      if (s === 0) {
        score = 0;
        break;
      }
      score += s;
    }
    if (score > 0) hits.push({ doc, score });
  }
  return hits.sort((a, b) => b.score - a.score || b.doc.publishedAt.localeCompare(a.doc.publishedAt));
}
