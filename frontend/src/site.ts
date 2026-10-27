// next.config.ts inlines both at build time.
export const BASE_PATH = process.env.BASE_PATH ?? "";
export const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "";

/** Absolute URL of a site path such as "/posts/X/", basePath included. */
export const absoluteUrl = (path: string): string => `${SITE_ORIGIN}${BASE_PATH}${path}`;

// Pages without an image of their own share this one; make-icons.ts renders it from public/icon.svg.
export const DEFAULT_OG_IMAGE = absoluteUrl("/og-default.png");

// A page's own openGraph replaces the layout's instead of merging, so pages spread this in.
// siteName is the profile's site title; this file is also imported by client components,
// so it takes the title instead of loading the snapshot.
export const siteOg = (siteName: string) => ({ siteName, locale: "zh_TW", type: "website" }) as const;

/** Dates on the site are shown in the author's time zone, not the build machine's. */
export const TIME_ZONE = "Asia/Taipei";
