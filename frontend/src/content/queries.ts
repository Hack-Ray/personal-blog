import type { DocId, PublicArticle, PublishedArticle, SiteContent, Slug, Taxon } from "./model.ts";

export function published(content: SiteContent): PublishedArticle[] {
  return content.articles
    .filter((a): a is PublishedArticle => a.state === "published")
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
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
