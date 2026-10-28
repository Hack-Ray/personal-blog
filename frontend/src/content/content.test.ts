import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadSiteContent } from "./load.ts";
import { renderMarkdown } from "./markdown.ts";
import type { DocId, Slug } from "./model.ts";
import { ContentError, DEFAULT_PROFILE, DEFAULT_SITE, parseSnapshot, type Snapshot } from "./parse.ts";
import { archive, findArticle, inSeries, inTopic, neighbors, page, PAGE_SIZE, pinned, postPath, postSegments, published, related, tags, taxonCounts, topics, withTag } from "./queries.ts";
import { coverOf, excerptOf, thumbnailOf } from "./card.ts";
import { sitemapEntries } from "./sitemap.ts";

const A = "01K7M4Y7P65BDCF8AHRTQY7ZQA";
const B = "01K7M4Y7P65BDCF8AHRTQY7ZQB";
const C = "01K7M4Y7P65BDCF8AHRTQY7ZQC";
const D = "01K7M4Y7P65BDCF8AHRTQY7ZQD";

const articleFile = (docId: string, overrides: Record<string, unknown> = {}) => ({
  doc_id: docId,
  version: 1,
  title: "Title",
  topic: { slug: "backend", name: "Backend" },
  tags: [],
  published_at: "2026-10-01T00:00:00Z",
  markdown: "body",
  ...overrides,
});

function snapshot({
  manifest = {},
  files = {},
  images = [],
  profile,
}: {
  manifest?: Record<string, unknown>;
  files?: Record<string, unknown>;
  images?: string[];
  profile?: unknown;
}): Snapshot {
  return {
    profile,
    manifest: {
      schema_version: 1,
      release_id: "01K82XH4C5V6B7N8M9P0Q1R2S3",
      created_at: "2026-10-20T00:00:00Z",
      articles: Object.keys(files).map((doc_id) => ({ doc_id, version: 1 })),
      archived_articles: [],
      ...manifest,
    },
    readArticle: (docId) => {
      if (!(docId in files)) throw new ContentError(`articles/${docId}.json: file not found`);
      return files[docId];
    },
    hasImage: (name) => images.includes(name),
  };
}

test("the committed sample snapshot loads", () => {
  const content = loadSiteContent();
  assert.equal(published(content).length, 3);
  assert.equal(content.articles.filter((a) => a.state === "archived").length, 1);
});

const profileFile = (overrides: Record<string, unknown> = {}) => ({
  name: "Ray",
  headline: "",
  intro: "",
  links: [{ label: "GitHub", url: "https://github.com/Hack-Ray" }],
  experience: [{ role: "Engineer", organization: "", period: "", description: "" }],
  projects: [{ name: "Blog", description: "", tags: ["Next.js"] }],
  ...overrides,
});

test("the committed sample snapshot has a profile with a Markdown intro", () => {
  const { profile } = loadSiteContent();
  assert.equal(profile.name, "Hack-Ray");
  assert.match(renderMarkdown(profile.intro, ""), /<strong>Python<\/strong>/);
  assert.equal(profile.projects.length, 1);
  assert.deepEqual(profile.site, { title: "Hack-Ray 的技術筆記", description: "後端、自動化與自建 CMS 的軟體工程文章", footer: "" });
});

test("a snapshot without profile.json falls back to the default profile", () => {
  assert.deepEqual(parseSnapshot(snapshot({})).profile, DEFAULT_PROFILE);
  assert.equal(DEFAULT_PROFILE.name, "Your Name");
  assert.deepEqual(DEFAULT_PROFILE.links, []);
  assert.deepEqual(DEFAULT_PROFILE.site, { title: "Personal Blog", description: "", footer: "" });
});

test("a profile.json without site gets the default site", () => {
  assert.deepEqual(parseSnapshot(snapshot({ profile: profileFile() })).profile.site, DEFAULT_SITE);
});

test("the site title, description and footer are read from profile.json", () => {
  const site = { title: "Ray's notes", description: "", footer: "© Ray. CC BY 4.0" };
  assert.deepEqual(parseSnapshot(snapshot({ profile: profileFile({ site }) })).profile.site, site);
});

test("a site exported before the footer field existed gets an empty footer", () => {
  const site = { title: "Ray's notes", description: "" };
  assert.equal(parseSnapshot(snapshot({ profile: profileFile({ site }) })).profile.site.footer, "");
});

test("rejects a site with a blank title or wrong types", () => {
  const bad = (site: unknown) => () => parseSnapshot(snapshot({ profile: profileFile({ site }) }));
  assert.throws(bad({ title: " ", description: "" }), /profile\.json\.site\.title: expected a non-empty string/);
  assert.throws(bad({ description: "x" }), /profile\.json\.site\.title/);
  assert.throws(bad({ title: "x", description: 1 }), /profile\.json\.site\.description: expected a string/);
  assert.throws(bad({ title: "x", description: "", footer: null }), /profile\.json\.site\.footer: expected a string/);
  assert.throws(bad("Personal Blog"), /profile\.json\.site: expected an object/);
  assert.throws(bad(null), /profile\.json\.site: expected an object/);
});

test("a project url is optional and kept when present", () => {
  const projects = [{ name: "A", description: "", tags: [] }, { name: "B", url: "mailto:me@example.com", description: "", tags: [] }];
  const { profile } = parseSnapshot(snapshot({ profile: profileFile({ projects }) }));
  assert.deepEqual(profile.projects, projects);
  assert.equal("url" in profile.projects[0]!, false);
});

test("rejects profile links and project urls that are not https or mailto", () => {
  for (const url of ["http://example.com", "javascript:alert(1)", "https://", "", "/about/"]) {
    assert.throws(() => parseSnapshot(snapshot({ profile: profileFile({ links: [{ label: "x", url }] }) })), /profile\.json\.links\[0\]\.url/);
    const projects = [{ name: "x", url, description: "", tags: [] }];
    assert.throws(() => parseSnapshot(snapshot({ profile: profileFile({ projects }) })), /profile\.json\.projects\[0\]\.url/);
  }
});

test("rejects a profile with a blank name or a malformed list", () => {
  assert.throws(() => parseSnapshot(snapshot({ profile: profileFile({ name: " " }) })), /profile\.json\.name/);
  assert.throws(() => parseSnapshot(snapshot({ profile: profileFile({ links: {} }) })), /profile\.json\.links: expected an array/);
  assert.throws(() => parseSnapshot(snapshot({ profile: profileFile({ experience: [{ role: "" }] }) })), /experience\[0\]\.role/);
  assert.throws(() => parseSnapshot(snapshot({ profile: profileFile({ intro: null }) })), /profile\.json\.intro: expected a string/);
  assert.throws(() => parseSnapshot(snapshot({ profile: [] })), /profile\.json: expected an object/);
});

test("rejects a profile intro that references an image missing from the snapshot", () => {
  const profile = profileFile({ intro: "![me](images/me.webp)" });
  assert.throws(() => parseSnapshot(snapshot({ profile })), /profile\.json: references missing image images\/me\.webp/);
  assert.equal(parseSnapshot(snapshot({ profile, images: ["me.webp"] })).profile.intro, "![me](images/me.webp)");
});

test("an archived article carries only its docId", () => {
  const content = parseSnapshot(snapshot({ manifest: { archived_articles: [{ doc_id: B }] } }));
  assert.deepEqual(content.articles, [{ state: "archived", docId: B }]);
});

test("rejects an unknown schema version", () => {
  assert.throws(() => parseSnapshot(snapshot({ manifest: { schema_version: 2 } })), /schema_version: expected 1, got 2/);
});

test("rejects docIds that are not uppercase ULIDs", () => {
  for (const docId of [A.toLowerCase(), A.slice(1), `${A.slice(0, -1)}I`, `8${A.slice(1)}`]) {
    assert.throws(() => parseSnapshot(snapshot({ files: { [docId]: articleFile(docId) } })), /ULID/);
  }
});

test("rejects a manifest entry whose article file is missing", () => {
  assert.throws(
    () => parseSnapshot(snapshot({ manifest: { articles: [{ doc_id: A, version: 1 }] } })),
    /articles\/01K7M4Y7P65BDCF8AHRTQY7ZQA\.json: file not found/,
  );
});

test("rejects an article file from a different release version", () => {
  assert.throws(
    () => parseSnapshot(snapshot({ files: { [A]: articleFile(A, { version: 2 }) } })),
    /manifest expects 1, file has 2/,
  );
});

test("rejects an article file whose doc_id does not match its name", () => {
  assert.throws(() => parseSnapshot(snapshot({ files: { [A]: articleFile(B) } })), /expected 01K7M4Y7P65BDCF8AHRTQY7ZQA, got 01K7M4Y7P65BDCF8AHRTQY7ZQB/);
});

test("rejects a docId listed as both published and archived", () => {
  assert.throws(
    () => parseSnapshot(snapshot({ files: { [A]: articleFile(A) }, manifest: { archived_articles: [{ doc_id: A }] } })),
    /listed more than once/,
  );
});

test("rejects an article that references an image missing from the snapshot", () => {
  const files = { [A]: articleFile(A, { markdown: "![x](images/abc.webp)" }) };
  assert.throws(() => parseSnapshot(snapshot({ files })), /missing image images\/abc\.webp/);
  assert.equal(parseSnapshot(snapshot({ files, images: ["abc.webp"] })).articles.length, 1);
});

test("rejects an unparseable publish date", () => {
  assert.throws(() => parseSnapshot(snapshot({ files: { [A]: articleFile(A, { published_at: "yesterday" }) } })), /ISO 8601/);
  // Without Z or an offset, a build in Taipei and one in UTC would date the article 8 hours apart.
  assert.throws(() => parseSnapshot(snapshot({ files: { [A]: articleFile(A, { published_at: "2026-10-01T09:00:00" }) } })), /with Z or an offset/);
  assert.doesNotThrow(() => parseSnapshot(snapshot({ files: { [A]: articleFile(A, { published_at: "2026-10-01T09:00:00.123456Z" }) } })));
});

test("published lists newest first and leaves out archived articles", () => {
  const content = parseSnapshot(
    snapshot({
      files: {
        [A]: articleFile(A, { published_at: "2026-01-01T00:00:00Z" }),
        [C]: articleFile(C, { published_at: "2026-03-01T00:00:00Z" }),
      },
      manifest: { archived_articles: [{ doc_id: B }] },
    }),
  );
  assert.deepEqual(published(content).map((a) => a.docId), [C, A]);
  assert.equal(findArticle(content, B)?.article.state, "archived");
  assert.equal(findArticle(content, "01K7M4Y7P65BDCF8AHRTQY7ZQD")?.article, undefined);
});

test("topics and tags come only from published articles", () => {
  const python = { slug: "python", name: "Python" };
  const content = parseSnapshot(
    snapshot({
      files: {
        [A]: articleFile(A, { tags: [python] }),
        [C]: articleFile(C, { topic: { slug: "frontend", name: "Frontend" }, tags: [python] }),
      },
    }),
  );
  assert.deepEqual(topics(content).map((t) => t.slug), ["backend", "frontend"]);
  assert.deepEqual(tags(content).map((t) => t.slug), ["python"]);
  assert.equal(inTopic(content, "frontend" as Slug).length, 1);
  assert.equal(withTag(content, "python" as Slug).length, 2);
});

test("snapshot image references resolve under the basePath", () => {
  const html = renderMarkdown("![a](images/abc.svg) ![b](https://example.com/x.png)", "/personal-blog");
  assert.match(html, /src="\/personal-blog\/images\/abc\.svg"/);
  assert.match(html, /src="https:\/\/example\.com\/x\.png"/);
});

test("images listed in the size manifest get width and height; others and remote images do not", () => {
  const sizes = { "images/abc.svg": { width: 320, height: 120 } };
  const html = renderMarkdown("![a](images/abc.svg) ![b](images/other.png) ![c](https://example.com/x.png)", "/personal-blog", sizes);
  assert.match(html, /src="\/personal-blog\/images\/abc\.svg" alt="a" width="320" height="120"/);
  assert.equal(html.match(/width=/g)?.length, 1);
  assert.match(renderMarkdown("![a](images/abc.svg)", "", sizes), /src="\/images\/abc\.svg" alt="a" width="320"/);
});

test("fenced code in a known language is highlighted with light and dark variables", () => {
  const html = renderMarkdown("```ts\nconst x = 1;\n```", "");
  assert.match(html, /<pre class="shiki/);
  assert.match(html, /--shiki-light:#[0-9A-Fa-f]+/);
  assert.match(html, /--shiki-dark:#[0-9A-Fa-f]+/);
});

test("fenced code in an unknown or missing language is escaped plain text", () => {
  for (const fence of ["```nope\n<b>&</b>\n```", "```\n<b>&</b>\n```"]) {
    assert.match(renderMarkdown(fence, ""), /<pre><code>&lt;b&gt;&amp;&lt;\/b&gt;<\/code><\/pre>/);
  }
});

test("neighbors gives the newer and older published articles and skips archived ones", () => {
  const content = parseSnapshot(
    snapshot({
      manifest: { archived_articles: [{ doc_id: C }] },
      files: {
        [A]: articleFile(A, { published_at: "2026-01-01T00:00:00Z" }),
        [B]: articleFile(B, { published_at: "2026-02-01T00:00:00Z" }),
        [D]: articleFile(D, { published_at: "2026-03-01T00:00:00Z" }),
      },
    }),
  );
  const ids = (docId: string) => {
    const n = neighbors(content, docId as DocId);
    return [n.newer?.docId, n.older?.docId];
  };
  assert.deepEqual(ids(B), [D, A]);
  assert.deepEqual(ids(D), [undefined, B]);
  assert.deepEqual(ids(A), [B, undefined]);
  assert.deepEqual(ids(C), [undefined, undefined]);
});

test("every code block gets a copy button that starts hidden", () => {
  for (const fence of ["```ts\nconst x = 1;\n```", "```\nplain\n```"]) {
    assert.match(renderMarkdown(fence, ""), /^<div class="code-block"><pre[\s\S]*<\/pre><button type="button" class="copy-code" aria-live="polite" hidden>複製<\/button><\/div>/);
  }
});

test("an image alone in its paragraph becomes a figure captioned with its escaped alt text", () => {
  assert.equal(
    renderMarkdown('![A <b> & "x"](images/a.png)', "/bp"),
    '<figure><img src="/bp/images/a.png" alt="A &lt;b&gt; &amp; &quot;x&quot;" fetchpriority="high" decoding="async"><figcaption>A &lt;b&gt; &amp; &quot;x&quot;</figcaption></figure>\n',
  );
});

test("only the first image of a page loads right away; the rest load lazily", () => {
  const html = renderMarkdown("![a](images/a.png)\n\n![b](images/b.png)\n\n![c](images/c.png)", "");
  assert.deepEqual(html.match(/fetchpriority="high"|loading="lazy"/g), ['fetchpriority="high"', 'loading="lazy"', 'loading="lazy"']);
  assert.match(renderMarkdown("![a](images/a.png)", ""), /fetchpriority="high"/, "each page starts over");
});

test("inline images, images without alt text and linked images stay in their paragraph", () => {
  for (const md of ["text ![i](images/b.png)", "![](images/c.png)", "[![x](images/d.png)](https://e.com)"]) {
    const html = renderMarkdown(md, "");
    assert.match(html, /^<p>/);
    assert.doesNotMatch(html, /figure/);
  }
});

test("taxonCounts counts published articles per topic or tag, most first", () => {
  const python = { slug: "python", name: "Python" };
  const go = { slug: "go", name: "Go" };
  const content = parseSnapshot(
    snapshot({
      manifest: { archived_articles: [{ doc_id: D }] },
      files: {
        [A]: articleFile(A, { tags: [python, go] }),
        [B]: articleFile(B, { tags: [python] }),
        [C]: articleFile(C, { topic: { slug: "frontend", name: "Frontend" } }),
      },
    }),
  );
  const flat = (counts: ReturnType<typeof taxonCounts>) => counts.map((c) => [c.taxon.slug, c.count]);
  assert.deepEqual(flat(taxonCounts(content, (a) => [a.topic])), [["backend", 2], ["frontend", 1]]);
  assert.deepEqual(flat(taxonCounts(content, (a) => a.tags)), [["python", 2], ["go", 1]]);
});

test("related ranks a shared topic above one shared tag and skips unrelated articles", () => {
  const E = "01K7M4Y7P65BDCF8AHRTQY7ZQE";
  const t = (slug: string) => ({ slug, name: slug });
  const content = parseSnapshot(
    snapshot({
      files: {
        [A]: articleFile(A, { tags: [t("python"), t("api")] }),
        [B]: articleFile(B, { topic: t("frontend"), tags: [t("python")], published_at: "2026-10-03T00:00:00Z" }),
        [C]: articleFile(C, { published_at: "2026-10-02T00:00:00Z" }),
        [D]: articleFile(D, { tags: [t("python")], published_at: "2026-09-01T00:00:00Z" }),
        [E]: articleFile(E, { topic: t("life") }),
      },
    }),
  );
  const ids = (docId: string, limit?: number) => related(content, docId as DocId, limit).map((a) => a.docId);
  assert.deepEqual(ids(A), [D, C, B]);
  assert.deepEqual(ids(A, 1), [D]);
  assert.deepEqual(ids(E), []);
});

const IMG = "images/cover.webp";

test("optional article fields are read when present and left out when absent", () => {
  const series = { slug: "build-a-cms", name: "自建 CMS" };
  const content = parseSnapshot(
    snapshot({
      images: ["cover.webp"],
      files: {
        [A]: articleFile(A, {
          markdown: `![](${IMG})`,
          updated_at: "2026-10-05T00:00:00Z",
          excerpt: "Short",
          cover: IMG,
          series,
          pinned_at: "2026-10-06T00:00:00Z",
        }),
        [B]: articleFile(B),
      },
    }),
  );
  const [a, b] = [A, B].map((id) => findArticle(content, id)?.article);
  assert.ok(a?.state === "published" && b?.state === "published");
  assert.equal(a.updatedAt?.toISOString(), "2026-10-05T00:00:00.000Z");
  assert.equal(a.pinnedAt?.toISOString(), "2026-10-06T00:00:00.000Z");
  assert.deepEqual([a.excerpt, a.cover, a.series], ["Short", IMG, series]);
  for (const key of ["updatedAt", "excerpt", "cover", "series", "pinnedAt"]) assert.ok(!(key in b), key);
});

test("rejects a cover the article does not contain and malformed optional fields", () => {
  const bad = (overrides: Record<string, unknown>) => () =>
    parseSnapshot(snapshot({ images: ["cover.webp"], files: { [A]: articleFile(A, overrides) } }));
  assert.throws(bad({ cover: IMG }), /articles\/.*\.json\.cover: "images\/cover\.webp" is not an image the article contains/);
  assert.throws(bad({ excerpt: " " }), /\.excerpt: expected a non-empty string/);
  assert.throws(bad({ updated_at: "yesterday" }), /\.updated_at: expected an ISO 8601 date/);
  assert.throws(bad({ series: { slug: "Bad", name: "x" } }), /\.series\.slug/);
  assert.throws(bad({ pinned_at: 1 }), /\.pinned_at/);
});

test("the author's excerpt and cover win over the ones derived from the Markdown", () => {
  const content = parseSnapshot(
    snapshot({
      images: ["first.webp", "cover.webp"],
      files: {
        [A]: articleFile(A, { markdown: `Opening text\n\n![](images/first.webp) ![](${IMG})`, excerpt: "Short", cover: IMG }),
        [B]: articleFile(B, { markdown: "Opening text\n\n![](images/first.webp)" }),
      },
    }),
  );
  const [a, b] = [A, B].map((id) => findArticle(content, id)?.article);
  assert.ok(a?.state === "published" && b?.state === "published");
  assert.deepEqual([excerptOf(a), coverOf(a)], ["Short", IMG]);
  assert.deepEqual([excerptOf(b), coverOf(b)], ["Opening text", "images/first.webp"]);
});

test("raster images get a WebP thumbnail and SVGs are used as is", () => {
  assert.equal(thumbnailOf("images/abc.png"), "thumbs/abc.webp");
  assert.equal(thumbnailOf("images/abc.webp"), "thumbs/abc.webp");
  assert.equal(thumbnailOf("images/abc.svg"), "images/abc.svg");
});

test("pinned lists pinned articles, most recently pinned first", () => {
  const content = parseSnapshot(
    snapshot({
      files: {
        [A]: articleFile(A, { pinned_at: "2026-10-01T00:00:00Z" }),
        [B]: articleFile(B),
        [C]: articleFile(C, { pinned_at: "2026-10-02T00:00:00Z" }),
      },
    }),
  );
  assert.deepEqual(pinned(content).map((a) => a.docId), [C, A]);
});

test("inSeries lists the series oldest first and leaves out other articles", () => {
  const series = { slug: "s", name: "S" };
  const content = parseSnapshot(
    snapshot({
      files: {
        [A]: articleFile(A, { series, published_at: "2026-03-01T00:00:00Z" }),
        [B]: articleFile(B, { series, published_at: "2026-01-01T00:00:00Z" }),
        [C]: articleFile(C),
      },
    }),
  );
  assert.deepEqual(inSeries(content, "s" as Slug).map((a) => a.docId), [B, A]);
});

const ulid = (i: number) => `01K7M4Y7P65BDCF8AHRTQY${String(i).padStart(4, "0")}`;

test("page splits published articles newest first into pages of PAGE_SIZE", () => {
  const files = Object.fromEntries(
    Array.from({ length: PAGE_SIZE + 2 }, (_, i) => [ulid(i), articleFile(ulid(i), { published_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString() })]),
  );
  const content = parseSnapshot(snapshot({ files }));
  assert.equal(page(content, 1).pages, 2);
  assert.equal(page(content, 1).articles.length, PAGE_SIZE);
  assert.deepEqual(page(content, 2).articles.map((a) => a.docId), [ulid(1), ulid(0)]);
  assert.equal(page(parseSnapshot(snapshot({})), 1).pages, 1);
});

test("archive groups by year and month in the given time zone, keeping the order", () => {
  const content = parseSnapshot(
    snapshot({
      files: {
        // 2026-01-01 08:00 in Taipei
        [A]: articleFile(A, { published_at: "2026-01-01T00:00:00Z" }),
        // 2026-01-01 01:00 in Taipei, still 2025 in UTC
        [B]: articleFile(B, { published_at: "2025-12-31T17:00:00Z" }),
        [C]: articleFile(C, { published_at: "2025-11-15T00:00:00Z" }),
      },
    }),
  );
  const flat = archive(published(content), "Asia/Taipei").map((y) => [y.year, y.months.map((m) => [m.month, m.articles.map((a) => a.docId)])]);
  assert.deepEqual(flat, [
    [2026, [[1, [A, B]]]],
    [2025, [[11, [C]]]],
  ]);
  const oldest = archive(published(content).toReversed(), "Asia/Taipei").map((y) => [y.year, y.months.map((m) => m.articles.map((a) => a.docId))]);
  assert.deepEqual(oldest, [
    [2025, [[C]]],
    [2026, [[B, A]]],
  ]);
});

test("the sitemap uses the update time of an updated article", () => {
  const content = parseSnapshot(snapshot({ files: { [A]: articleFile(A, { updated_at: "2026-10-05T00:00:00Z" }) } }));
  const entry = sitemapEntries(content).find((e) => e.path === `/posts/${A}/`);
  assert.equal(entry?.lastModified?.toISOString(), "2026-10-05T00:00:00.000Z");
});

test("links to other sites open in a new tab and only text links get the external marker", () => {
  assert.equal(
    renderMarkdown("[a](https://example.com/x)", ""),
    '<p><a href="https://example.com/x" target="_blank" rel="noopener noreferrer" class="external">a</a></p>\n',
  );
  assert.match(renderMarkdown("[![x](images/d.png)](https://e.com)", ""), /<a href="https:\/\/e\.com" target="_blank" rel="noopener noreferrer"><img/);
  assert.equal(renderMarkdown("[b](/posts/X/) [c](#top)", ""), '<p><a href="/posts/X/">b</a> <a href="#top">c</a></p>\n');
});

test("raw HTML in Markdown is shown as text", () => {
  assert.equal(renderMarkdown("<script>alert(1)</script>", ""), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n");
  assert.equal(renderMarkdown("a <img src=x onerror=alert(1)> b", ""), "<p>a &lt;img src=x onerror=alert(1)&gt; b</p>\n");
});

test("URLs outside the policy are not output as links or images", () => {
  const cases: { markdown: string; blocked: string[] }[] = JSON.parse(
    readFileSync(new URL("../../test-fixtures/url-policy.json", import.meta.url), "utf8"),
  );
  for (const { markdown, blocked } of cases) {
    const html = renderMarkdown(markdown, "");
    for (const url of blocked) assert.ok(!html.includes(`="${url}`), `${url} in ${html}`);
  }
  assert.equal(renderMarkdown("[x](javascript:alert(1))", ""), "<p>x</p>\n");
  assert.equal(renderMarkdown("![alt](data:image/png;base64,AAAA)", ""), "<p>alt</p>\n");
});

test("a disallowed URL fails the build", () => {
  const files = { [A]: articleFile(A, { markdown: "[x](javascript:alert(1))" }) };
  assert.throws(() => parseSnapshot(snapshot({ files })), /articles\/.*\.json: URLs not allowed in articles: javascript:alert\(1\)/);
  const profile = profileFile({ intro: "![x](http://x.dev/a.png)" });
  assert.throws(() => parseSnapshot(snapshot({ profile })), /profile\.json: URLs not allowed in articles: http:\/\/x\.dev\/a\.png/);
});

test("an article with a slug lives at its slug and its earlier URLs redirect to it", () => {
  const content = parseSnapshot(
    snapshot({
      files: { [A]: articleFile(A), [B]: articleFile(B) },
      manifest: {
        articles: [
          { doc_id: A, version: 1, slug: "hello", redirect_from: [A, "old-hello"] },
          { doc_id: B, version: 1 },
        ],
        archived_articles: [{ doc_id: C, slug: "gone", redirect_from: [C] }],
      },
    }),
  );
  const { article: a, redirect } = findArticle(content, "hello")!;
  assert.equal(redirect, false);
  assert.equal(postPath(a), "/posts/hello/");
  assert.equal(postPath(findArticle(content, B)!.article), `/posts/${B}/`);
  assert.deepEqual(findArticle(content, A), { article: a, redirect: true });
  assert.equal(findArticle(content, "old-hello")?.redirect, true);
  assert.equal(findArticle(content, "gone")?.article.state, "archived");
  assert.equal(findArticle(content, C)?.redirect, true);
  assert.deepEqual(postSegments(content).sort(), [A, B, C, "gone", "hello", "old-hello"].sort());
  assert.deepEqual(sitemapEntries(content).filter((e) => e.path.startsWith("/posts/") && !e.path.startsWith("/posts/page/")).map((e) => e.path).sort(), [
    "/posts/",
    `/posts/${B}/`,
    "/posts/hello/",
  ].sort());
});

test("an article without a slug or earlier URL has no redirect pages", () => {
  const content = parseSnapshot(snapshot({ files: { [A]: articleFile(A) } }));
  const a = content.articles[0]!;
  assert.ok(!("slug" in a) && !("redirectFrom" in a));
  assert.deepEqual(postSegments(content), [A]);
});

test("rejects a malformed or reserved slug and a URL two articles claim", () => {
  const bad = (articles: Record<string, unknown>[], archived: Record<string, unknown>[] = []) => () =>
    parseSnapshot(snapshot({ files: { [A]: articleFile(A), [B]: articleFile(B) }, manifest: { articles, archived_articles: archived } }));
  const b = { doc_id: B, version: 1 };
  assert.throws(bad([{ doc_id: A, version: 1, slug: "Hello" }, b]), /manifest\.articles\[0\]\.slug: "Hello" is not a lowercase kebab-case slug/);
  assert.throws(bad([{ doc_id: A, version: 1, slug: "a".repeat(81) }, b]), /\.slug: .* up to 80 characters/);
  assert.throws(bad([{ doc_id: A, version: 1, slug: "page" }, b]), /\.slug: "page" is reserved/);
  assert.throws(bad([{ doc_id: A, version: 1, redirect_from: ["Not A Slug"] }, b]), /\.redirect_from\[0\]/);
  assert.throws(bad([{ doc_id: A, version: 1, slug: "x" }, { ...b, slug: "x" }]), /\/posts\/x\/ is claimed by both/);
  assert.throws(bad([{ doc_id: A, version: 1, slug: "x" }, { ...b, redirect_from: ["x"] }]), /\/posts\/x\/ is claimed by both/);
  assert.throws(bad([{ doc_id: A, version: 1 }, { ...b, redirect_from: [A] }]), new RegExp(`/posts/${A}/ is claimed by both`));
  assert.throws(bad([{ doc_id: A, version: 1 }, b], [{ doc_id: C, redirect_from: ["page"] }]), /archived_articles\[0\]\.redirect_from\[0\]: "page" is reserved/);
});
