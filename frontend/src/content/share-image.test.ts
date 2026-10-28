import assert from "node:assert/strict";
import { test } from "node:test";
import type { DocId, PublishedArticle, Slug } from "./model.ts";
import { hasCjk, hasGeneratedShareImage, shareImageOf, shareImageSvg, wrapTitle } from "./share-image.ts";

const article: PublishedArticle = {
  state: "published",
  docId: "01K7M4Y7P65BDCF8AHRTQY7ZQA" as DocId,
  title: "標題",
  topic: { slug: "backend" as Slug, name: "Backend" },
  tags: [],
  publishedAt: new Date("2026-01-01T00:00:00Z"),
  markdown: "正文",
};

const svg = (title: string) => shareImageSvg({ title, siteTitle: "Site" });
const titleLines = (out: string) => [...out.matchAll(/<tspan [^>]*>(.*?)<\/tspan>/g)].map((m) => m[1]!);

test("an article without a cover or image is drawn, keyed by docId so a slug change keeps the file", () => {
  assert.equal(hasGeneratedShareImage(article), true);
  assert.equal(shareImageOf(article), `og/${article.docId}.png`);
  assert.equal(shareImageOf({ ...article, slug: "renamed" as Slug }), `og/${article.docId}.png`);
});

test("a cover, or the first uploaded image, is used instead of a drawn image", () => {
  const withCover = { ...article, cover: "images/a.png" };
  assert.equal(hasGeneratedShareImage(withCover), false);
  assert.equal(shareImageOf(withCover), "images/a.png");
  const withImage = { ...article, markdown: "![x](images/first.png)" };
  assert.equal(hasGeneratedShareImage(withImage), false);
  assert.equal(shareImageOf(withImage), "images/first.png");
});

test("the title, site title, topic and date are escaped", () => {
  const out = shareImageSvg({ title: `A & B <script> "x" 'y'`, siteTitle: "<Me> & co", topic: "R&D", date: "1 < 2" });
  assert.ok(!out.includes("<script>") && !out.includes("<Me>"));
  assert.ok(out.includes("A &amp; B &lt;script&gt; &quot;x&quot; &#39;y&#39;"));
  assert.ok(out.includes("&lt;Me&gt; &amp; co"));
  assert.ok(out.includes("R&amp;D  ·  1 &lt; 2"));
});

test("control characters that XML forbids are dropped", () => {
  assert.ok(!svg("a\u0000b\u0008c").includes("\u0000"));
});

test("English breaks at spaces and never inside a word", () => {
  const title = "Building a static blog with Next.js and GitHub Pages";
  const lines = wrapTitle(title, 20);
  assert.ok(lines.length > 1);
  const words = title.split(" ");
  for (const l of lines) assert.ok(l.split(" ").every((w) => words.includes(w)), l);
  assert.equal(lines.join(" "), title);
});

test("Chinese breaks between characters at the line width", () => {
  assert.deepEqual(wrapTitle("用靜態網站產生器打造個人部落格的完整過程", 8), ["用靜態網站產生器", "打造個人部落格的", "完整過程"]);
});

test("a closing mark does not start a line and an opening mark does not end one", () => {
  const closing = wrapTitle("這是一個很長的標題，後面還有字", 7);
  assert.ok(closing.every((l) => !"，。、！？）」』".includes(l[0]!)), closing.join("|"));
  const opening = wrapTitle("這是一個很長的「引用」標題", 7);
  assert.ok(opening.every((l) => !"（「『".includes(l.at(-1)!)), opening.join("|"));
  assert.equal(opening.join(""), "這是一個很長的「引用」標題");
});

test("mixed Chinese and English keeps words whole", () => {
  const lines = wrapTitle("Next.js 靜態網站部署到 GitHub Pages 的筆記", 10);
  assert.ok(lines.some((l) => l.includes("GitHub")));
  assert.ok(lines.every((l) => !/Gi$|^ub/.test(l)));
});

test("a word wider than a line is broken instead of overflowing", () => {
  const lines = wrapTitle("Supercalifragilisticexpialidocious", 10);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(""), "Supercalifragilisticexpialidocious");
});

test("a title over three lines ends in an ellipsis that still fits", () => {
  const lines = wrapTitle("很長".repeat(100), 10);
  assert.equal(lines.length, 3);
  assert.ok(lines[2]!.endsWith("…"));
  assert.ok([...lines[2]!].length <= 10);
  assert.ok(!wrapTitle("short title", 10).some((l) => l.includes("…")));
});

test("the drawn title is at most three lines, and a longer title shrinks before it is cut", () => {
  const medium = titleLines(svg("用靜態網站產生器打造個人部落格的完整過程與踩過的坑"));
  assert.ok(medium.length <= 3 && !medium.at(-1)!.endsWith("…"));
  const long = titleLines(svg("很長".repeat(100)));
  assert.equal(long.length, 3);
  assert.ok(long[2]!.endsWith("…"));
  const size = (t: string) => Number(/<text font-size="(\d+)"/.exec(svg(t))![1]);
  assert.ok(size("Hi") > size("很長".repeat(100)));
});

test("an empty title still produces a valid image", () => {
  const out = svg("");
  assert.ok(out.startsWith("<svg") && out.trimEnd().endsWith("</svg>"));
});

test("hasCjk finds Chinese and fullwidth marks but not plain Latin", () => {
  assert.equal(hasCjk("標題"), true);
  assert.equal(hasCjk("Title，"), true);
  assert.equal(hasCjk("Title: Next.js"), false);
});
