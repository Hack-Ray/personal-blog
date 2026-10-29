import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaxonUsage } from "./api.ts";
import { entryFor, suggest } from "./taxa.ts";

const usage = (slug: string, name: string, articles: number): TaxonUsage => ({ slug, name, articles, in_use: articles > 0 });
const options = [
  usage("rpgle", "RPGLE", 2),
  usage("rpg", "RPG", 5),
  usage("sprint", "Sprint", 9),
  usage("python", "Python", 7),
  usage("as400", "AS/400", 1),
];

test("suggest puts prefix matches before substring matches, then most used", () => {
  assert.deepEqual(suggest(options, "r", []).map((o) => o.slug), ["rpg", "rpgle", "sprint"]);
});

test("suggest puts an exact slug first even past the suggestion limit", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ slug: `as${i}x`, name: `AS ${i}`, articles: 9, in_use: true }));
  const all = [...many, { slug: "as", name: "AS", articles: 0, in_use: true }];
  assert.equal(suggest(all, "as", [])[0]?.slug, "as");
});

test("suggest matches the display name case-insensitively", () => {
  assert.deepEqual(suggest(options, "PYTH", []).map((o) => o.slug), ["python"]);
  assert.deepEqual(suggest(options, "as/", []).map((o) => o.slug), ["as400"]);
});

test("suggest leaves out selected taxa and non-matches", () => {
  assert.deepEqual(suggest(options, "r", [{ slug: "rpg", name: "RPG" }]).map((o) => o.slug), ["rpgle", "sprint"]);
  assert.deepEqual(suggest(options, "zzz", []), []);
});

test("empty query lists everything unselected by usage, capped", () => {
  assert.deepEqual(suggest(options, "", []).map((o) => o.slug), ["sprint", "python", "rpg", "rpgle", "as400"]);
  const many = Array.from({ length: 20 }, (_, i) => usage(`t${i}`, `T${i}`, i));
  assert.equal(suggest(many, "", []).length, 8);
});

test("entryFor returns the stored taxon when the slug already exists", () => {
  assert.deepEqual(entryFor(options, "rpg"), { kind: "existing", taxon: { slug: "rpg", name: "RPG" } });
  assert.deepEqual(entryFor(options, "rpg:Other"), { kind: "existing", taxon: { slug: "rpg", name: "RPG" } });
});

test("entryFor builds a new taxon, naming it after the slug by default", () => {
  assert.deepEqual(entryFor(options, "newtag:新標籤"), { kind: "new", taxon: { slug: "newtag", name: "新標籤" } });
  assert.deepEqual(entryFor(options, " go "), { kind: "new", taxon: { slug: "go", name: "go" } });
  assert.deepEqual(entryFor(options, "a:b:c"), { kind: "new", taxon: { slug: "a", name: "b:c" } });
});

test("entryFor rejects slugs that are not lowercase kebab-case", () => {
  assert.deepEqual(entryFor(options, "Python"), { kind: "invalid" });
  assert.deepEqual(entryFor(options, "後端:Backend"), { kind: "invalid" });
  assert.deepEqual(entryFor(options, ""), { kind: "invalid" });
});
