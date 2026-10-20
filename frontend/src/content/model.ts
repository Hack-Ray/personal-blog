export type DocId = string & { readonly __brand: "DocId" };
export type Slug = string & { readonly __brand: "Slug" };

export interface Taxon {
  slug: Slug;
  name: string;
}

export interface PublishedArticle {
  state: "published";
  docId: DocId;
  title: string;
  topic: Taxon;
  tags: Taxon[];
  publishedAt: Date;
  markdown: string;
}

export interface ArchivedArticle {
  state: "archived";
  docId: DocId;
}

// Draft, Pending Deletion and Permanently Deleted articles are never part of
// the public build, so their URLs fall through to the 404 page.
export type PublicArticle = PublishedArticle | ArchivedArticle;

export interface SiteContent {
  articles: PublicArticle[];
}
