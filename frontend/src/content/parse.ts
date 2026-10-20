import type { DocId, PublicArticle, SiteContent, Slug, Taxon } from "./model.ts";

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ContentError extends Error {}

function fail(path: string, message: string): never {
  throw new ContentError(`${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(path, "expected a non-empty string");
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value;
}

export function parseDocId(value: unknown, path = "docId"): DocId {
  const s = string(value, path);
  if (!ULID.test(s)) fail(path, `"${s}" is not an uppercase 26-character ULID`);
  return s as DocId;
}

function parseTaxon(value: unknown, path: string): Taxon {
  const o = record(value, path);
  const slug = string(o.slug, `${path}.slug`);
  if (!SLUG.test(slug)) fail(`${path}.slug`, `"${slug}" is not a lowercase kebab-case slug`);
  return { slug: slug as Slug, name: string(o.name, `${path}.name`) };
}

function parseArticle(value: unknown, path: string): PublicArticle {
  const o = record(value, path);
  const docId = parseDocId(o.docId, `${path}.docId`);
  switch (o.state) {
    case "archived":
      return { state: "archived", docId };
    case "published": {
      const publishedAt = new Date(string(o.publishedAt, `${path}.publishedAt`));
      if (Number.isNaN(publishedAt.getTime())) fail(`${path}.publishedAt`, "expected an ISO 8601 date");
      return {
        state: "published",
        docId,
        title: string(o.title, `${path}.title`),
        topic: parseTaxon(o.topic, `${path}.topic`),
        tags: array(o.tags, `${path}.tags`).map((t, i) => parseTaxon(t, `${path}.tags[${i}]`)),
        publishedAt,
        markdown: string(o.markdown, `${path}.markdown`),
      };
    }
    default:
      fail(`${path}.state`, `expected "published" or "archived", got ${JSON.stringify(o.state)}`);
  }
}

export function parseSiteContent(value: unknown): SiteContent {
  const articles = array(record(value, "content").articles, "content.articles").map((a, i) =>
    parseArticle(a, `content.articles[${i}]`),
  );
  const seen = new Set<DocId>();
  for (const a of articles) {
    if (seen.has(a.docId)) fail("content.articles", `duplicate docId ${a.docId}`);
    seen.add(a.docId);
  }
  return { articles };
}
