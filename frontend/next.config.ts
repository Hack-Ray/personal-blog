import type { NextConfig } from "next";

// GitHub Pages serves the project site under /personal-blog. Set BASE_PATH=""
// once a custom domain is in place.
const basePath = process.env.BASE_PATH ?? "/personal-blog";

const config: NextConfig = {
  output: "export",
  basePath,
  env: { BASE_PATH: basePath },
  trailingSlash: true,
};

export default config;
