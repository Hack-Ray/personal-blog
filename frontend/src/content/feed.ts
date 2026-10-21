import type { SiteContent } from "./model.ts";
import { published } from "./queries.ts";
import { summary } from "./summary.ts";

const LIMIT = 20;

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** RSS 2.0 feed of the newest published articles; `url` maps a site path to an absolute URL. */
export function buildFeed(content: SiteContent, url: (path: string) => string): string {
  const posts = published(content).slice(0, LIMIT);
  const { site } = content.profile;
  const items = posts.map((a) => {
    const link = escapeXml(url(`/posts/${a.docId}/`));
    return [
      "    <item>",
      `      <title>${escapeXml(a.title)}</title>`,
      `      <link>${link}</link>`,
      `      <guid isPermaLink="true">${link}</guid>`,
      `      <pubDate>${a.publishedAt.toUTCString()}</pubDate>`,
      `      <description>${escapeXml(summary(a.markdown))}</description>`,
      `      <category>${escapeXml(a.topic.name)}</category>`,
      "    </item>",
    ].join("\n");
  });
  // The newest article date, not the build time, keeps the output deterministic.
  const built = posts[0] ? [`    <lastBuildDate>${posts[0].publishedAt.toUTCString()}</lastBuildDate>`] : [];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${escapeXml(site.title)}</title>`,
    `    <link>${escapeXml(url("/"))}</link>`,
    // RSS requires a channel description, so an empty one falls back to the title.
    `    <description>${escapeXml(site.description || site.title)}</description>`,
    ...built,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
