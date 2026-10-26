import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFeed } from "./feed.ts";
import type { DocId, SiteContent, Slug } from "./model.ts";
import { DEFAULT_PROFILE } from "./parse.ts";

const url = (path: string) => `https://example.com/blog${path}`;
const post = (n: number, overrides: Record<string, unknown> = {}) => ({
  state: "published" as const,
  docId: `01K7M4Y7P65BDCF8AHRTQY7Z${String(n).padStart(2, "0")}` as DocId,
  title: `Post ${n}`,
  topic: { slug: "backend" as Slug, name: "Backend" },
  tags: [],
  publishedAt: new Date(Date.UTC(2026, 0, n)),
  markdown: `Body ${n}`,
  ...overrides,
});
const site = (...articles: SiteContent["articles"]): SiteContent => ({ articles, profile: DEFAULT_PROFILE });
const withSite = (title: string, description: string): SiteContent => ({
  articles: [],
  profile: { ...DEFAULT_PROFILE, site: { title, description, footer: "" } },
});

test("the channel title and description come from the profile's site", () => {
  const xml = buildFeed(withSite("Ray & Code", "Notes on <backend>"), url);
  assert.match(xml, /<channel>\n    <title>Ray &amp; Code<\/title>/);
  assert.match(xml, /<description>Notes on &lt;backend&gt;<\/description>/);
});

test("the channel links to its own address, as feed validators expect", () => {
  const xml = buildFeed(site(), url);
  assert.match(xml, /<rss version="2.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(xml, /<atom:link href="https:\/\/example\.com\/blog\/feed\.xml" rel="self" type="application\/rss\+xml"\/>/);
});

test("an empty site description falls back to the title, since RSS requires one", () => {
  const xml = buildFeed(withSite("Ray's notes", ""), url);
  assert.match(xml, /<description>Ray&apos;s notes<\/description>/);
  assert.match(buildFeed(site(), url), /<title>Personal Blog<\/title>\n    <link>[^<]*<\/link>\n    <description>Personal Blog<\/description>/);
});

test("feed items carry absolute link, guid, RFC 822 date, summary and topic, newest first", () => {
  const xml = buildFeed(site(post(1), post(2)), url);
  assert.ok(xml.indexOf("Post 2") < xml.indexOf("Post 1"));
  assert.match(xml, /<link>https:\/\/example\.com\/blog\/posts\/01K7M4Y7P65BDCF8AHRTQY7Z02\/<\/link>/);
  assert.match(xml, /<guid isPermaLink="false">urn:ulid:01K7M4Y7P65BDCF8AHRTQY7Z02<\/guid>/);
  assert.match(xml, /<pubDate>Fri, 02 Jan 2026 00:00:00 GMT<\/pubDate>/);
  assert.match(xml, /<description>Body 2<\/description>/);
  assert.match(xml, /<category>Backend<\/category>/);
  assert.match(xml, /<lastBuildDate>Fri, 02 Jan 2026 00:00:00 GMT<\/lastBuildDate>/);
});

test("feed escapes XML in titles, topics and descriptions", () => {
  const xml = buildFeed(
    site(post(1, { title: `A & <B> "C"`, topic: { slug: "x", name: "R&D" }, markdown: "1 < 2 & 3" })),
    url,
  );
  assert.match(xml, /<title>A &amp; &lt;B&gt; &quot;C&quot;<\/title>/);
  assert.match(xml, /<category>R&amp;D<\/category>/);
  assert.match(xml, /<description>1 &lt; 2 &amp; 3<\/description>/);
});

test("feed keeps the newest 20 published articles and leaves out archived ones", () => {
  const posts = Array.from({ length: 25 }, (_, i) => post(i + 1));
  const xml = buildFeed(site({ state: "archived", docId: "X" as DocId }, ...posts), url);
  assert.equal(xml.match(/<item>/g)?.length, 20);
  assert.ok(xml.includes("Post 25"));
  assert.ok(!xml.includes("Post 5<"));
});

test("a site with nothing published yields a valid empty feed", () => {
  const xml = buildFeed(site(), url);
  assert.equal(xml.match(/<item>/g), null);
  assert.ok(!xml.includes("lastBuildDate"));
  assert.match(xml, /<link>https:\/\/example\.com\/blog\/<\/link>/);
});

test("feed GUIDs survive a change of domain and basePath", () => {
  const a = buildFeed(site(post(1)), url);
  const b = buildFeed(site(post(1)), (path) => `https://new.example${path}`);
  assert.equal(a.match(/<guid[^>]*>.*<\/guid>/)?.[0], b.match(/<guid[^>]*>.*<\/guid>/)?.[0]);
  assert.ok(b.includes("https://new.example/posts/"));
});

test("an item links to the article's slug URL and keeps its docId guid", () => {
  const xml = buildFeed(site(post(1, { slug: "hello" as Slug })), url);
  assert.match(xml, /<link>https:\/\/example\.com\/blog\/posts\/hello\/<\/link>/);
  assert.match(xml, /<guid isPermaLink="false">urn:ulid:01K7M4Y7P65BDCF8AHRTQY7Z01<\/guid>/);
});
