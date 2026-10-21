import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSiteContent } from "./load.ts";
import { renderMarkdown } from "./markdown.ts";
import type { DocId, Slug } from "./model.ts";
import { ContentError, DEFAULT_PROFILE, DEFAULT_SITE, parseSnapshot, type Snapshot } from "./parse.ts";
import { findArticle, inTopic, neighbors, published, tags, topics, withTag } from "./queries.ts";

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
  assert.deepEqual(profile.site, { title: "Hack-Ray 的技術筆記", description: "後端、自動化與自建 CMS 的軟體工程文章" });
});

test("a snapshot without profile.json falls back to the default profile", () => {
  assert.deepEqual(parseSnapshot(snapshot({})).profile, DEFAULT_PROFILE);
  assert.equal(DEFAULT_PROFILE.name, "Hack-Ray");
  assert.deepEqual(DEFAULT_PROFILE.links, [{ label: "GitHub", url: "https://github.com/Hack-Ray" }]);
  assert.deepEqual(DEFAULT_PROFILE.site, { title: "Personal Blog", description: "" });
});

test("a profile.json without site gets the default site", () => {
  assert.deepEqual(parseSnapshot(snapshot({ profile: profileFile() })).profile.site, DEFAULT_SITE);
});

test("the site title and description are read from profile.json", () => {
  const site = { title: "Ray's notes", description: "" };
  assert.deepEqual(parseSnapshot(snapshot({ profile: profileFile({ site }) })).profile.site, site);
});

test("rejects a site with a blank title or wrong types", () => {
  const bad = (site: unknown) => () => parseSnapshot(snapshot({ profile: profileFile({ site }) }));
  assert.throws(bad({ title: " ", description: "" }), /profile\.json\.site\.title: expected a non-empty string/);
  assert.throws(bad({ description: "x" }), /profile\.json\.site\.title/);
  assert.throws(bad({ title: "x", description: 1 }), /profile\.json\.site\.description: expected a string/);
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
  assert.equal(findArticle(content, B as DocId)?.state, "archived");
  assert.equal(findArticle(content, "01K7M4Y7P65BDCF8AHRTQY7ZQD" as DocId), undefined);
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

test("fenced code in a known language is highlighted with light and dark variables", () => {
  const html = renderMarkdown("```ts\nconst x = 1;\n```", "");
  assert.match(html, /<pre class="shiki/);
  assert.match(html, /--shiki-light:#[0-9A-Fa-f]+/);
  assert.match(html, /--shiki-dark:#[0-9A-Fa-f]+/);
});

test("fenced code in an unknown or missing language is escaped plain text", () => {
  for (const fence of ["```nope\n<b>&</b>\n```", "```\n<b>&</b>\n```"]) {
    assert.equal(renderMarkdown(fence, ""), "<pre><code>&lt;b&gt;&amp;&lt;/b&gt;</code></pre>\n");
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
