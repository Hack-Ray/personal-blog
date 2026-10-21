import type { SiteContent } from "./model.ts";
import { published } from "./queries.ts";
import { plainText } from "./summary.ts";

export interface SearchDoc {
  docId: string;
  title: string;
  topic: string;
  tags: string[];
  publishedAt: string;
  text: string;
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
}

const TEXT_LIMIT = 5000;
// A term found in the title outranks one found in the topic or tags, which
// outranks one found only in the body.
const WEIGHT = { title: 10, taxon: 5, text: 1 };

export function buildIndex(content: SiteContent): SearchDoc[] {
  return published(content).map((a) => ({
    docId: a.docId,
    title: a.title,
    topic: a.topic.name,
    tags: a.tags.map((t) => t.name),
    publishedAt: a.publishedAt.toISOString(),
    text: [a.excerpt, plainText(a.markdown)].filter(Boolean).join(" ").slice(0, TEXT_LIMIT),
  }));
}

const terms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** Every term must match somewhere; results are best first, then newest. */
export function search(index: SearchDoc[], query: string): SearchHit[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const doc of index) {
    const title = doc.title.toLowerCase();
    const taxa = [doc.topic, ...doc.tags].join(" ").toLowerCase();
    const text = doc.text.toLowerCase();
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
