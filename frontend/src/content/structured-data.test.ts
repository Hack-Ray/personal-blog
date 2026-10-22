import assert from "node:assert/strict";
import { test } from "node:test";
import type { DocId, PublishedArticle, Slug } from "./model.ts";
import { blogPosting, jsonLd, webSite } from "./structured-data.ts";

const taxon = (name: string) => ({ slug: name.toLowerCase() as Slug, name });
const profile = { name: "Ray", links: [] };

const base: PublishedArticle = {
  state: "published",
  docId: "01K7M4Y7P65BDCF8AHRTQY7ZQA" as DocId,
  title: "標題",
  topic: taxon("Backend"),
  tags: [],
  publishedAt: new Date("2026-01-01T00:00:00Z"),
  markdown: "正文",
};

test("a bare article gets the required fields and none of the optional ones", () => {
  const d = blogPosting(base, profile);
  assert.equal(d["@type"], "BlogPosting");
  assert.equal(d.headline, "標題");
  assert.equal(d.description, "正文");
  assert.equal(d.datePublished, "2026-01-01T00:00:00.000Z");
  assert.equal(d.dateModified, d.datePublished);
  assert.ok(d.url.endsWith(`/posts/${base.docId}/`));
  assert.equal(d.mainEntityOfPage, d.url);
  assert.equal(d.articleSection, "Backend");
  assert.equal(d.inLanguage, "zh-Hant");
  assert.equal(d.author.name, "Ray");
  assert.ok(d.author.url.endsWith("/about/"));
  assert.ok(!("image" in d));
  assert.ok(!("keywords" in d));
  assert.ok(!("sameAs" in d.author));
});

test("the author lists the profile's https links as sameAs, without mailto", () => {
  const links = [
    { label: "GitHub", url: "https://github.com/Hack-Ray" },
    { label: "Email", url: "mailto:me@example.com" },
    { label: "LinkedIn", url: "https://www.linkedin.com/in/example" },
  ];
  assert.deepEqual(blogPosting(base, { name: "Ray", links }).author.sameAs, [
    "https://github.com/Hack-Ray",
    "https://www.linkedin.com/in/example",
  ]);
});

test("cover, tags and updatedAt show up when the article has them", () => {
  const d = blogPosting(
    { ...base, cover: "images/a.png", tags: [taxon("Python"), taxon("API")], updatedAt: new Date("2026-02-01T00:00:00Z") },
    profile,
  );
  assert.ok(d.image?.endsWith("/images/a.png"));
  assert.deepEqual(d.keywords, ["Python", "API"]);
  assert.equal(d.dateModified, "2026-02-01T00:00:00.000Z");
});

test("webSite omits an empty description", () => {
  assert.equal(webSite({ title: "T", description: "", footer: "" }).hasOwnProperty("description"), false);
  assert.equal(webSite({ title: "T", description: "D", footer: "" }).description, "D");
});

test("jsonLd round-trips and cannot close the script element", () => {
  const d = blogPosting({ ...base, title: "</script><script>alert(1)</script>" }, profile);
  const out = jsonLd(d);
  assert.ok(!out.includes("<"));
  assert.deepEqual(JSON.parse(out), d);
});
