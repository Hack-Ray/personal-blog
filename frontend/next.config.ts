import type { NextConfig } from "next";

// GitHub Pages serves the project site under /personal-blog. With a custom
// domain, set BASE_PATH="" and SITE_ORIGIN to that domain.
const basePath = process.env.BASE_PATH ?? "/personal-blog";
const siteOrigin = process.env.SITE_ORIGIN ?? "https://hack-ray.github.io";

const config: NextConfig = {
  output: "export",
  basePath,
  env: { BASE_PATH: basePath, SITE_ORIGIN: siteOrigin },
  trailingSlash: true,
};

export default config;
