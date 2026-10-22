import { absoluteUrl } from "../site.ts";
import { coverOf, excerptOf } from "./card.ts";
import type { Profile, PublishedArticle } from "./model.ts";

/** schema.org BlogPosting; the fields agree with the article page's openGraph. */
export function blogPosting(a: PublishedArticle, profile: Pick<Profile, "name" | "links">) {
  const url = absoluteUrl(`/posts/${a.docId}/`);
  const cover = coverOf(a);
  // The profile's other accounts, so Google can tell this author from others with the same name.
  const sameAs = profile.links.map((l) => l.url).filter((u) => u.startsWith("https://"));
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: a.title,
    description: excerptOf(a),
    datePublished: a.publishedAt.toISOString(),
    dateModified: (a.updatedAt ?? a.publishedAt).toISOString(),
    url,
    mainEntityOfPage: url,
    ...(cover && { image: absoluteUrl(`/${cover}`) }),
    author: { "@type": "Person", name: profile.name, url: absoluteUrl("/about/"), ...(sameAs.length > 0 && { sameAs }) },
    ...(a.tags.length > 0 && { keywords: a.tags.map((t) => t.name) }),
    articleSection: a.topic.name,
    inLanguage: "zh-Hant",
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
