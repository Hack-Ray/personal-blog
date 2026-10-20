// next.config.ts inlines both at build time.
export const BASE_PATH = process.env.BASE_PATH ?? "";
export const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "";

/** Absolute URL of a site path such as "/posts/X/", basePath included. */
export const absoluteUrl = (path: string): string => `${SITE_ORIGIN}${BASE_PATH}${path}`;
