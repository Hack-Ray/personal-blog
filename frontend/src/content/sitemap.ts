import type { SiteContent } from "./model.ts";
import { page, postPath, published, tags, topics } from "./queries.ts";

interface SitemapEntry {
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
    ...Array.from({ length: page(content, 1).pages - 1 }, (_, i) => ({ path: `/posts/page/${i + 2}/`, lastModified: newest })),
    { path: "/archive/", lastModified: newest },
    { path: "/about/" },
    { path: "/topics/" },
    { path: "/tags/" },
    ...posts.map((a) => ({ path: postPath(a), lastModified: a.updatedAt ?? a.publishedAt })),
    ...topics(content).map((t) => ({ path: `/topics/${t.slug}/` })),
    ...tags(content).map((t) => ({ path: `/tags/${t.slug}/` })),
  ];
}
