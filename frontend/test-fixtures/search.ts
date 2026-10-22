import type { DocId, PublishedArticle, SiteContent, Slug } from "../src/content/model.ts";
import { DEFAULT_PROFILE } from "../src/content/parse.ts";

export function article(docId: string, year: number, overrides: Partial<PublishedArticle> = {}): PublishedArticle {
  return {
    state: "published", docId: docId as DocId, title: docId,
    topic: { slug: "backend" as Slug, name: "Backend" }, tags: [],
    publishedAt: new Date(`${year}-01-01T00:00:00Z`), markdown: "",
    ...overrides,
  };
}

export const content = (...articles: SiteContent["articles"]): SiteContent => ({ articles, profile: DEFAULT_PROFILE });
