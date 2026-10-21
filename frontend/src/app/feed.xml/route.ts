import { buildFeed } from "../../content/feed.ts";
import { loadSiteContent } from "../../content/load.ts";
import { absoluteUrl } from "../../site.ts";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildFeed(loadSiteContent(), absoluteUrl), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
