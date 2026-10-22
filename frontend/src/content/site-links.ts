/** Old site roots include the old basePath, so sibling sites on the same host stay external. */
export function legacySiteUrls(value: string): string[] {
  return value.split(",").map((v) => v.trim().replace(/\/+$/, "")).filter(Boolean).map((value) => {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("LEGACY_SITE_URLS must contain http(s) site roots without credentials, queries or fragments");
    }
    return url.href.replace(/\/+$/, "");
  }).sort((a, b) => b.length - a.length);
}

export function migrateSiteLink(href: string, basePath: string, roots: readonly string[]): string {
  for (const root of roots) {
    if (href === root || href.startsWith(`${root}/`) || href.startsWith(`${root}?`) || href.startsWith(`${root}#`)) {
      const suffix = href.slice(root.length);
      return `${basePath}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
    }
  }
  return href;
}
