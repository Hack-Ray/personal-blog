import type { DocId, PublicArticle, PublishedArticle, SiteContent, Slug, Taxon } from "./model.ts";

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_REF = /\]\((images\/[^)\s]+)/g;

export const SCHEMA_VERSION = 1;

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

function positiveInt(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) fail(path, "expected a positive integer");
  return value as number;
}

function date(value: unknown, path: string): Date {
  const d = new Date(string(value, path));
  if (Number.isNaN(d.getTime())) fail(path, "expected an ISO 8601 date");
  return d;
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

export interface Manifest {
  releaseId: string;
  createdAt: Date;
  articles: { docId: DocId; version: number }[];
  archived: DocId[];
}

export function parseManifest(value: unknown): Manifest {
  const o = record(value, "manifest");
  if (o.schema_version !== SCHEMA_VERSION) {
    fail("manifest.schema_version", `expected ${SCHEMA_VERSION}, got ${JSON.stringify(o.schema_version)}`);
  }
  return {
    releaseId: parseDocId(o.release_id, "manifest.release_id"),
    createdAt: date(o.created_at, "manifest.created_at"),
    articles: array(o.articles, "manifest.articles").map((a, i) => {
      const e = record(a, `manifest.articles[${i}]`);
      return {
        docId: parseDocId(e.doc_id, `manifest.articles[${i}].doc_id`),
        version: positiveInt(e.version, `manifest.articles[${i}].version`),
      };
    }),
    archived: array(o.archived_articles, "manifest.archived_articles").map((a, i) =>
      parseDocId(record(a, `manifest.archived_articles[${i}]`).doc_id, `manifest.archived_articles[${i}].doc_id`),
    ),
  };
}

export interface ArticleFile extends PublishedArticle {
  version: number;
}

export function parseArticleFile(value: unknown, path: string): ArticleFile {
  const o = record(value, path);
  return {
    state: "published",
    docId: parseDocId(o.doc_id, `${path}.doc_id`),
    version: positiveInt(o.version, `${path}.version`),
    title: string(o.title, `${path}.title`),
    topic: parseTaxon(o.topic, `${path}.topic`),
    tags: array(o.tags, `${path}.tags`).map((t, i) => parseTaxon(t, `${path}.tags[${i}]`)),
    publishedAt: date(o.published_at, `${path}.published_at`),
    markdown: string(o.markdown, `${path}.markdown`),
  };
}

export function imageRefs(markdown: string): string[] {
  return [...markdown.matchAll(IMAGE_REF)].map((m) => m[1]!);
}

export interface Snapshot {
  manifest: unknown;
  readArticle(docId: DocId): unknown;
  hasImage(name: string): boolean;
}

// Checks that every file the manifest names exists and belongs to the same
// release, so a partial or mixed snapshot fails the build instead of deploying.
export function parseSnapshot(snapshot: Snapshot): SiteContent {
  const manifest = parseManifest(snapshot.manifest);
  const seen = new Set<DocId>();
  const claim = (docId: DocId) => {
    if (seen.has(docId)) fail("manifest", `docId ${docId} is listed more than once`);
    seen.add(docId);
  };

  const articles: PublicArticle[] = manifest.articles.map(({ docId, version }) => {
    claim(docId);
    const path = `articles/${docId}.json`;
    const { version: fileVersion, ...article } = parseArticleFile(snapshot.readArticle(docId), path);
    if (article.docId !== docId) fail(`${path}.doc_id`, `expected ${docId}, got ${article.docId}`);
    if (fileVersion !== version) fail(`${path}.version`, `manifest expects ${version}, file has ${fileVersion}`);
    for (const ref of imageRefs(article.markdown)) {
      if (!snapshot.hasImage(ref.slice("images/".length))) fail(path, `references missing image ${ref}`);
    }
    return article;
  });

  for (const docId of manifest.archived) {
    claim(docId);
    articles.push({ state: "archived", docId });
  }
  return { articles };
}
