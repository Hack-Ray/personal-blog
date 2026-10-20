import type { Taxon } from "./api.ts";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Parses "slug" or "slug:Name" items separated by commas. */
export function parseTags(input: string): { tags: Taxon[]; invalid: string[] } {
  const tags: Taxon[] = [];
  const invalid: string[] = [];
  for (const item of input.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [slug, ...rest] = item.split(":");
    const name = rest.join(":").trim() || slug!.trim();
    if (SLUG.test(slug!.trim())) tags.push({ slug: slug!.trim(), name });
    else invalid.push(item);
  }
  return { tags, invalid };
}

export function formatTags(tags: Taxon[]): string {
  return tags.map((t) => (t.name === t.slug ? t.slug : `${t.slug}:${t.name}`)).join(", ");
}

export const isSlug = (s: string) => SLUG.test(s);
