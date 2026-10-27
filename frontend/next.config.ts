import type { NextConfig } from "next";

// The defaults suit local builds and the checks in scripts/ and e2e/. deploy.yml
// sets BASE_PATH and SITE_ORIGIN from the repo's Pages URL; another host sets
// them to where it serves the site (BASE_PATH="" at a domain's root).
const basePath = process.env.BASE_PATH ?? "/personal-blog";
const siteOrigin = process.env.SITE_ORIGIN ?? "https://example.com";

// Canonical URLs, the sitemap, the feed and Open Graph are built from these, so a
// wrong value would point search engines elsewhere; stop the build instead.
if (!/^https?:\/\/[^/\s]+$/.test(siteOrigin)) throw new Error(`SITE_ORIGIN must be like https://example.com (no path or trailing slash), got "${siteOrigin}"`);
if (basePath !== "" && !/^\/[^\s]*[^/\s]$/.test(basePath)) throw new Error(`BASE_PATH must be empty or like /blog (no trailing slash), got "${basePath}"`);

// giscus comments show only when both IDs are set (https://giscus.app).
const giscus = {
  GISCUS_REPO: process.env.GISCUS_REPO ?? "",
  GISCUS_REPO_ID: process.env.GISCUS_REPO_ID ?? "",
  GISCUS_CATEGORY: process.env.GISCUS_CATEGORY ?? "Announcements",
  GISCUS_CATEGORY_ID: process.env.GISCUS_CATEGORY_ID ?? "",
};

const config: NextConfig = {
  output: "export",
  basePath,
  env: { BASE_PATH: basePath, SITE_ORIGIN: siteOrigin, LEGACY_SITE_URLS: process.env.LEGACY_SITE_URLS ?? "", ...giscus },
  trailingSlash: true,
};

export default config;
