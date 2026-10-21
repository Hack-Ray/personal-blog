import type { SiteContent } from "./model.ts";
import { published, tags, topics } from "./queries.ts";

export interface SitemapEntry {
  path: string;
  lastModified?: Date;
}

/** Every indexable page. Archived articles are noindex, so they are left out. */
export function sitemapEntries(content: SiteContent): SitemapEntry[] {
  const posts = published(content);
  const newest = posts[0]?.publishedAt;
  return [
    { path: "/", lastModified: newest },
    { path: "/posts/", lastModified: newest },
    { path: "/about/" },
    { path: "/topics/" },
    { path: "/tags/" },
    ...posts.map((a) => ({ path: `/posts/${a.docId}/`, lastModified: a.publishedAt })),
    ...topics(content).map((t) => ({ path: `/topics/${t.slug}/` })),
    ...tags(content).map((t) => ({ path: `/tags/${t.slug}/` })),
  ];
}
