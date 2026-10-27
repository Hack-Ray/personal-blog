import { Marked } from "marked";
import { blockedUrls } from "./url-policy.ts";
import type { ArticleUrls, DocId, Profile, PublicArticle, PublishedArticle, SiteContent, Slug, Taxon } from "./model.ts";
import { urlSegment } from "./queries.ts";

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MARKDOWN = new Marked();
const URL_SCHEME = /^(https:\/\/|mailto:)\S+$/;
const ARTICLE_SLUG_MAX_LENGTH = 80;
// /posts/page/<n>/ is the article list.
const RESERVED_ARTICLE_SLUGS = new Set(["page"]);

const SCHEMA_VERSION = 1;

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

function text(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "expected a string");
  return value;
}

function url(value: unknown, path: string): string {
  const s = string(value, path);
  if (!URL_SCHEME.test(s)) fail(path, `"${s}" must start with https:// or mailto:`);
  return s;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value;
}

function positiveInt(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) fail(path, "expected a positive integer");
  return value as number;
}

// A time without Z or an offset would be read in the build machine's time zone.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function date(value: unknown, path: string): Date {
  const s = string(value, path);
  const d = new Date(s);
  if (!ISO_DATE_TIME.test(s) || Number.isNaN(d.getTime())) fail(path, "expected an ISO 8601 date and time with Z or an offset");
  return d;
}

function parseDocId(value: unknown, path = "docId"): DocId {
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

function parseArticleSlug(value: unknown, path: string): Slug {
  const slug = string(value, path);
  if (!SLUG.test(slug) || slug.length > ARTICLE_SLUG_MAX_LENGTH) {
    fail(path, `"${slug}" is not a lowercase kebab-case slug of up to ${ARTICLE_SLUG_MAX_LENGTH} characters`);
  }
  if (RESERVED_ARTICLE_SLUGS.has(slug)) fail(path, `"${slug}" is reserved`);
  return slug as Slug;
}

const parseSegment = (value: unknown, path: string): string =>
  typeof value === "string" && ULID.test(value) ? value : parseArticleSlug(value, path);

function parseUrls(e: Record<string, unknown>, path: string): ArticleUrls {
  return {
    ...optional(e, "slug", path, parseArticleSlug),
    ...(e.redirect_from === undefined
      ? {}
      : { redirectFrom: array(e.redirect_from, `${path}.redirect_from`).map((s, i) => parseSegment(s, `${path}.redirect_from[${i}]`)) }),
  };
}

interface Manifest {
  releaseId: string;
  createdAt: Date;
  articles: ({ docId: DocId; version: number } & ArticleUrls)[];
  archived: ({ docId: DocId } & ArticleUrls)[];
}

function parseManifest(value: unknown): Manifest {
  const o = record(value, "manifest");
  if (o.schema_version !== SCHEMA_VERSION) {
    fail("manifest.schema_version", `expected ${SCHEMA_VERSION}, got ${JSON.stringify(o.schema_version)}`);
  }
  return {
    releaseId: parseDocId(o.release_id, "manifest.release_id"),
    createdAt: date(o.created_at, "manifest.created_at"),
    articles: array(o.articles, "manifest.articles").map((a, i) => {
      const path = `manifest.articles[${i}]`;
      const e = record(a, path);
      return {
        docId: parseDocId(e.doc_id, `${path}.doc_id`),
        version: positiveInt(e.version, `${path}.version`),
        ...parseUrls(e, path),
      };
    }),
    archived: array(o.archived_articles, "manifest.archived_articles").map((a, i) => {
      const path = `manifest.archived_articles[${i}]`;
      const e = record(a, path);
      return { docId: parseDocId(e.doc_id, `${path}.doc_id`), ...parseUrls(e, path) };
    }),
  };
}

interface ArticleFile extends PublishedArticle {
  version: number;
}

// Keys exported only when set; an absent key leaves the field out.
function optional<T>(o: Record<string, unknown>, key: string, path: string, parse: (v: unknown, path: string) => T) {
  return o[key] === undefined ? {} : { [key]: parse(o[key], `${path}.${key}`) };
}

function parseArticleFile(value: unknown, path: string): ArticleFile {
  const o = record(value, path);
  const markdown = string(o.markdown, `${path}.markdown`);
  return {
    state: "published",
    docId: parseDocId(o.doc_id, `${path}.doc_id`),
    version: positiveInt(o.version, `${path}.version`),
    title: string(o.title, `${path}.title`),
    topic: parseTaxon(o.topic, `${path}.topic`),
    tags: array(o.tags, `${path}.tags`).map((t, i) => parseTaxon(t, `${path}.tags[${i}]`)),
    publishedAt: date(o.published_at, `${path}.published_at`),
    ...(o.updated_at === undefined ? {} : { updatedAt: date(o.updated_at, `${path}.updated_at`) }),
    markdown,
    ...optional(o, "excerpt", path, string),
    ...optional(o, "cover", path, (v, p) => {
      const cover = string(v, p);
      if (!imagePaths(markdown).includes(cover)) fail(p, `"${cover}" is not an image the article contains`);
      return cover;
    }),
    ...optional(o, "series", path, parseTaxon),
    ...(o.pinned_at === undefined ? {} : { pinnedAt: date(o.pinned_at, `${path}.pinned_at`) }),
  };
}

// Same default as the backend's Site model; profile.json files exported before
// the site fields existed have no "site" key.
export const DEFAULT_SITE: Profile["site"] = { title: "Personal Blog", description: "", footer: "" };

// Snapshots exported before the CMS managed the profile have no profile.json.
export const DEFAULT_PROFILE: Profile = {
  name: "Your Name",
  headline: "",
  intro: "",
  links: [],
  experience: [],
  projects: [],
  site: DEFAULT_SITE,
};

function parseSite(value: unknown, path: string): Profile["site"] {
  if (value === undefined) return { ...DEFAULT_SITE };
  const o = record(value, path);
  return {
    title: string(o.title, `${path}.title`),
    description: text(o.description, `${path}.description`),
    // Exported before the footer field existed.
    footer: o.footer === undefined ? "" : text(o.footer, `${path}.footer`),
  };
}

function parseProfile(value: unknown, path = "profile.json"): Profile {
  const o = record(value, path);
  const list = <T>(key: string, item: (o: Record<string, unknown>, path: string) => T): T[] =>
    array(o[key], `${path}.${key}`).map((v, i) => item(record(v, `${path}.${key}[${i}]`), `${path}.${key}[${i}]`));
  return {
    name: string(o.name, `${path}.name`),
    headline: text(o.headline, `${path}.headline`),
    intro: text(o.intro, `${path}.intro`),
    links: list("links", (l, p) => ({ label: string(l.label, `${p}.label`), url: url(l.url, `${p}.url`) })),
    experience: list("experience", (e, p) => ({
      role: string(e.role, `${p}.role`),
      organization: text(e.organization, `${p}.organization`),
      period: text(e.period, `${p}.period`),
      description: text(e.description, `${p}.description`),
    })),
    projects: list("projects", (j, p) => ({
      name: string(j.name, `${p}.name`),
      ...(j.url === undefined ? {} : { url: url(j.url, `${p}.url`) }),
      description: text(j.description, `${p}.description`),
      tags: array(j.tags, `${p}.tags`).map((t, i) => string(t, `${p}.tags[${i}]`)),
    })),
    site: parseSite(o.site, `${path}.site`),
  };
}

export function imagePaths(markdown: string): string[] {
  const refs: string[] = [];
  MARKDOWN.walkTokens(MARKDOWN.lexer(markdown), (token) => {
    if (token.type === "image" && token.href.startsWith("images/")) refs.push(token.href);
  });
  return refs;
}

export interface Snapshot {
  manifest: unknown;
  /** undefined when the snapshot has no profile.json */
  profile?: unknown;
  readArticle(docId: DocId): unknown;
  hasImage(name: string): boolean;
}

function checkUrls(markdown: string, path: string) {
  const blocked = blockedUrls(markdown);
  if (blocked.length > 0) fail(path, `URLs not allowed in articles: ${blocked.join(", ")}`);
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

  const articles: PublicArticle[] = manifest.articles.map(({ docId, version, ...urls }) => {
    claim(docId);
    const path = `articles/${docId}.json`;
    const { version: fileVersion, ...article } = parseArticleFile(snapshot.readArticle(docId), path);
    if (article.docId !== docId) fail(`${path}.doc_id`, `expected ${docId}, got ${article.docId}`);
    if (fileVersion !== version) fail(`${path}.version`, `manifest expects ${version}, file has ${fileVersion}`);
    for (const ref of imagePaths(article.markdown)) {
      if (!snapshot.hasImage(ref.slice("images/".length))) fail(path, `references missing image ${ref}`);
    }
    checkUrls(article.markdown, path);
    return { ...article, ...urls };
  });

  for (const { docId, ...urls } of manifest.archived) {
    claim(docId);
    articles.push({ state: "archived", docId, ...urls });
  }
  const owners = new Map<string, DocId>();
  for (const a of articles) {
    for (const segment of [urlSegment(a), ...(a.redirectFrom ?? [])]) {
      const owner = owners.get(segment);
      if (owner) fail("manifest", `/posts/${segment}/ is claimed by both ${owner} and ${a.docId}`);
      owners.set(segment, a.docId);
    }
  }
  const profile = snapshot.profile === undefined ? DEFAULT_PROFILE : parseProfile(snapshot.profile);
  for (const ref of imagePaths(profile.intro)) {
    if (!snapshot.hasImage(ref.slice("images/".length))) fail("profile.json", `references missing image ${ref}`);
  }
  checkUrls(profile.intro, "profile.json");
  return { articles, profile };
}
