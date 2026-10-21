import type { DocId, PublicArticle, PublishedArticle, SiteContent, Slug, Taxon } from "./model.ts";

export function published(content: SiteContent): PublishedArticle[] {
  return content.articles
    .filter((a): a is PublishedArticle => a.state === "published")
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

/** The adjacent published articles by publication date; none for an archived or unknown docId. */
export function neighbors(content: SiteContent, docId: DocId): { newer?: PublishedArticle; older?: PublishedArticle } {
  const list = published(content);
  const i = list.findIndex((a) => a.docId === docId);
  if (i < 0) return {};
  return { newer: list[i - 1], older: list[i + 1] };
}

export function findArticle(content: SiteContent, docId: DocId): PublicArticle | undefined {
  return content.articles.find((a) => a.docId === docId);
}

function uniqueBySlug(taxa: Taxon[]): Taxon[] {
  return [...new Map(taxa.map((t) => [t.slug, t])).values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function topics(content: SiteContent): Taxon[] {
  return uniqueBySlug(published(content).map((a) => a.topic));
}

export function tags(content: SiteContent): Taxon[] {
  return uniqueBySlug(published(content).flatMap((a) => a.tags));
}

export function inTopic(content: SiteContent, slug: Slug): PublishedArticle[] {
  return published(content).filter((a) => a.topic.slug === slug);
}

export function withTag(content: SiteContent, slug: Slug): PublishedArticle[] {
  return published(content).filter((a) => a.tags.some((t) => t.slug === slug));
}

/** Every topic or tag with its published article count, most articles first. */
export function taxonCounts(content: SiteContent, of: (a: PublishedArticle) => Taxon[]): { taxon: Taxon; count: number }[] {
  const counts = new Map<Slug, { taxon: Taxon; count: number }>();
  for (const t of published(content).flatMap(of)) {
    const entry = counts.get(t.slug) ?? { taxon: t, count: 0 };
    entry.count++;
    counts.set(t.slug, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.taxon.name.localeCompare(b.taxon.name));
}

const RELATED_TOPIC_WEIGHT = 2;

/** Up to `limit` other published articles sharing the topic or a tag, best match then newest first. */
export function related(content: SiteContent, docId: DocId, limit = 3): PublishedArticle[] {
  const list = published(content);
  const self = list.find((a) => a.docId === docId);
  if (!self) return [];
  const selfTags = new Set(self.tags.map((t) => t.slug));
  const score = (a: PublishedArticle) =>
    (a.topic.slug === self.topic.slug ? RELATED_TOPIC_WEIGHT : 0) + a.tags.filter((t) => selfTags.has(t.slug)).length;
  return list
    .filter((a) => a !== self)
    .map((a) => ({ a, s: score(a) }))
    .filter(({ s }) => s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, limit)
    .map(({ a }) => a);
}
