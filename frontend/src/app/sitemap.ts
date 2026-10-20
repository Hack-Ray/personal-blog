import type { MetadataRoute } from "next";
import { loadSiteContent } from "../content/load.ts";
import { sitemapEntries } from "../content/sitemap.ts";
import { absoluteUrl } from "../site.ts";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries(loadSiteContent()).map(({ path, lastModified }) => ({ url: absoluteUrl(path), lastModified }));
}
