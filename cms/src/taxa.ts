import type { Taxon, TaxonUsage } from "./api.ts";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isSlug = (s: string) => SLUG.test(s);

export const SUGGESTION_LIMIT = 8;

export type Entry = { kind: "existing"; taxon: Taxon } | { kind: "new"; taxon: Taxon } | { kind: "invalid" };

// An exact slug ranks first so Enter picks it even when many taxa share the prefix.
const rank = (t: Taxon, q: string): number => {
  if (q === "") return 0;
  const slug = t.slug.toLowerCase();
  const name = t.name.toLowerCase();
  if (slug === q) return 0;
  if (slug.startsWith(q) || name.startsWith(q)) return 1;
  return slug.includes(q) || name.includes(q) ? 2 : -1;
};

export function suggest(options: TaxonUsage[], query: string, selected: Taxon[]): TaxonUsage[] {
  const q = query.trim().toLowerCase();
  const taken = new Set(selected.map((t) => t.slug));
  return options
    .filter((o) => !taken.has(o.slug))
    .map((o) => ({ o, r: rank(o, q) }))
    .filter(({ r }) => r >= 0)
    .sort((a, b) => a.r - b.r || b.o.articles - a.o.articles || a.o.slug.localeCompare(b.o.slug))
    .slice(0, SUGGESTION_LIMIT)
    .map(({ o }) => o);
}

/** Reads "slug" or "slug:名稱"; the name defaults to the slug. An existing slug keeps its stored name. */
export function entryFor(options: Taxon[], query: string): Entry {
  const [rawSlug = "", ...rest] = query.split(":");
  const slug = rawSlug.trim();
  if (!isSlug(slug)) return { kind: "invalid" };
  const existing = options.find((o) => o.slug === slug);
  if (existing) return { kind: "existing", taxon: { slug: existing.slug, name: existing.name } };
  return { kind: "new", taxon: { slug, name: rest.join(":").trim() || slug } };
}
