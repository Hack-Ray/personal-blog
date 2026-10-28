import { absoluteUrl } from "../site.ts";
import { excerptOf } from "./card.ts";
import type { Profile, PublishedArticle } from "./model.ts";
import { postPath } from "./queries.ts";
import { shareImageOf } from "./share-image.ts";

/** schema.org Person for the site's author, described by the About page. */
export function person(profile: Pick<Profile, "name" | "links">) {
  // The profile's other accounts, so Google can tell this author from others with the same name.
  const sameAs = profile.links.map((l) => l.url).filter((u) => u.startsWith("https://"));
  return { "@type": "Person", name: profile.name, url: absoluteUrl("/about/"), ...(sameAs.length > 0 && { sameAs }) } as const;
}

/** schema.org ProfilePage for the About page. */
export function profilePage(profile: Pick<Profile, "name" | "links">) {
  return { "@context": "https://schema.org", "@type": "ProfilePage", url: absoluteUrl("/about/"), mainEntity: person(profile) };
}

/** schema.org BlogPosting; the fields agree with the article page's openGraph. */
export function blogPosting(a: PublishedArticle, profile: Pick<Profile, "name" | "links">) {
  const url = absoluteUrl(postPath(a));
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: a.title,
    description: excerptOf(a),
    datePublished: a.publishedAt.toISOString(),
    dateModified: (a.updatedAt ?? a.publishedAt).toISOString(),
    url,
    mainEntityOfPage: url,
    // The page's og:image; Google asks Article results for one.
    image: absoluteUrl(`/${shareImageOf(a)}`),
    author: person(profile),
    ...(a.tags.length > 0 && { keywords: a.tags.map((t) => t.name) }),
    articleSection: a.topic.name,
    inLanguage: "zh-Hant",
  };
}

/** schema.org BreadcrumbList: the site, the article's topic, the article. */
export function breadcrumbList(a: PublishedArticle, siteTitle: string) {
  const trail = [
    { name: siteTitle, url: absoluteUrl("/") },
    { name: a.topic.name, url: absoluteUrl(`/topics/${a.topic.slug}/`) },
    { name: a.title, url: absoluteUrl(postPath(a)) },
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map(({ name, url }, i) => ({ "@type": "ListItem", position: i + 1, name, item: url })),
  };
}

/** schema.org WebSite; Google reads it on the home page for the site name. */
export function webSite(site: Profile["site"]) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.title,
    url: absoluteUrl("/"),
    ...(site.description && { description: site.description }),
  };
}

/** JSON for a <script type="application/ld+json"> body; `<` is escaped so "</script>" in a value cannot end the element. */
export const jsonLd = (data: object): string => JSON.stringify(data).replace(/</g, "\\u003c");
