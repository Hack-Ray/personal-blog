export type DocId = string & { readonly __brand: "DocId" };
export type Slug = string & { readonly __brand: "Slug" };

export interface Taxon {
  slug: Slug;
  name: string;
}

export interface ArticleUrls {
  /** The URL segment under /posts/; when absent, the docId. */
  slug?: Slug;
  /** Earlier URL segments (docIds or slugs) the site redirects to this article. */
  redirectFrom?: string[];
}

export interface PublishedArticle extends ArticleUrls {
  state: "published";
  docId: DocId;
  title: string;
  topic: Taxon;
  tags: Taxon[];
  publishedAt: Date;
  /** The latest publication, when the article was published more than once. */
  updatedAt?: Date;
  markdown: string;
  /** Written by the author; when absent, lists and previews use the start of the Markdown. */
  excerpt?: string;
  /** An images/ path the Markdown references; when absent, its first image is the cover. */
  cover?: string;
  series?: Taxon;
  pinnedAt?: Date;
}

export interface ArchivedArticle extends ArticleUrls {
  state: "archived";
  docId: DocId;
}

// Draft, Pending Deletion and Permanently Deleted articles are never part of
// the public build, so their URLs fall through to the 404 page.
export type PublicArticle = PublishedArticle | ArchivedArticle;

export interface Profile {
  name: string;
  headline: string;
  intro: string;
  links: { label: string; url: string }[];
  experience: { role: string; organization: string; period: string; description: string }[];
  projects: { name: string; url?: string; description: string; tags: string[] }[];
  /**
   * The site name and description for page titles, the header and the RSS feed, and the footer text.
   * description may be ""; footer "" means "© <year> <name>".
   */
  site: { title: string; description: string; footer: string };
}

export interface SiteContent {
  articles: PublicArticle[];
  profile: Profile;
}
