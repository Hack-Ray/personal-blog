import assert from "node:assert/strict";
import { test } from "node:test";
import { diagramSvg, diagramTitle, mermaidSources } from "./article-syntax.ts";
import { diagramKey } from "./diagrams.ts";
import { renderMarkdown } from "./markdown.ts";
import { plainText } from "./summary.ts";

const render = (md: string, diagrams = {}) => renderMarkdown(md, "/blog", {}, diagrams);

test("footnote references link to notes numbered by first reference, and each note links back", () => {
  const html = render("A[^b] B[^a] C[^b].\n\n[^a]: Note a\n[^b]: Note b\n");
  assert.match(html, /A<sup class="footnote-ref"><a id="fnref_1" href="#fn_1"[^>]*>1<\/a><\/sup>/);
  assert.match(html, /B<sup class="footnote-ref"><a id="fnref_2" href="#fn_2"[^>]*>2<\/a><\/sup>/);
  assert.match(html, /C<sup class="footnote-ref"><a id="fnref_1_2" href="#fn_1"[^>]*>1<\/a><\/sup>/);
  assert.match(html, /<section class="footnotes" aria-labelledby="footnotes_heading">\n<h2 id="footnotes_heading">註腳<\/h2>/);
  assert.match(html, /<li id="fn_1"><p>Note b <a href="#fnref_1"[^>]*>↩\uFE0E<\/a> <a href="#fnref_1_2"[^>]*>↩\uFE0E<sup>2<\/sup><\/a><\/p><\/li>/);
  assert.match(html, /<li id="fn_2"><p>Note a <a href="#fnref_2"/);
  assert.ok(html.indexOf("<section") > html.indexOf("C<sup"), "notes come after the text");
});

test("a reference without a note stays text, and a note nobody references is left out", () => {
  const html = render("x[^missing]\n\n[^unused]: hidden\n");
  assert.equal(html, "<p>x[^missing]</p>\n");
});

test("notes keep indented continuation lines and paragraphs", () => {
  const html = render("x[^1]\n\n[^1]: one\n    more\n\n    two\n");
  assert.match(html, /<li id="fn_1"><p>one\nmore<\/p>\n<p>two <a href="#fnref_1"/);
});

test("footnote ids cannot collide with heading ids", () => {
  const html = render("## fn_1\n\n## footnotes_heading\n\nx[^1]\n\n[^1]: n\n");
  assert.match(html, /<h2 id="fn1">/);
  assert.match(html, /<h2 id="footnotesheading">/);
  assert.equal(html.match(/id="fn_1"/g)?.length, 1);
});

test("notes follow the article's URL, image and raw HTML rules", () => {
  const html = render("x[^1]\n\n[^1]: [bad](javascript:alert(1)) ![i](images/a.png) <b onclick=x>\n");
  assert.match(html, /<li id="fn_1"><p>bad <img src="\/blog\/images\/a\.png"/);
  assert.match(html, /&lt;b onclick=x&gt;/);
  assert.doesNotMatch(html, /javascript:/);
});

test("a note label is never written into the page", () => {
  const html = render('x[^a"onclick=y]\n\n[^a"onclick=y]: n\n');
  assert.doesNotMatch(html, /onclick/);
  assert.match(html, /href="#fn_1"/);
});

test("each GitHub alert kind becomes a labelled callout", () => {
  const kinds = { NOTE: "注意", TIP: "提示", IMPORTANT: "重要", WARNING: "警告", CAUTION: "小心" };
  for (const [kind, label] of Object.entries(kinds)) {
    const html = render(`> [!${kind}]\n> Body *x*`);
    assert.match(html, new RegExp(`^<div class="callout callout-${kind.toLowerCase()}" role="note">\\n<p class="callout-title"><svg[^>]*aria-hidden="true">.*</svg>${label}</p>\\n<p>Body <em>x</em></p>\\n</div>\\n$`), kind);
  }
});

test("a callout keeps the rest of the quote, raw HTML shown as text", () => {
  const html = render("> [!warning]\n>\n> - one\n> - <script>x</script>");
  assert.match(html, /<div class="callout callout-warning" role="note">\n<p class="callout-title">.*警告<\/p>\n<ul>\n<li>one<\/li>\n<li><p>&lt;script&gt;x&lt;\/script&gt;<\/p>/);
});

test("an unknown, escaped or inline marker stays a normal blockquote", () => {
  for (const md of ["> [!FOO]\n> x", "> [!constructor]\n> x", "> \\[!NOTE]\n> x", "> [!NOTE] x", "> x\n> [!NOTE]"]) {
    const html = render(md);
    assert.match(html, /^<blockquote>/, md);
    assert.doesNotMatch(html, /callout/, md);
  }
});

const svg = (key: string, theme: string) =>
  `<svg id="mermaid-${key}-${theme}" role="img" aria-label="t"><marker id="mermaid-${key}-${theme}_end"></marker></svg>`;

test("a Mermaid block shows both theme variants of its rendered SVG", () => {
  const source = "flowchart LR\n  A --> B";
  const key = diagramKey(source);
  const html = render("```mermaid\n" + source + "\n```", { [key]: { light: svg(key, "light"), dark: svg(key, "dark") } });
  assert.equal(
    html,
    `<div class="diagram"><div class="diagram-light">${svg(key, "light")}</div><div class="diagram-dark">${svg(key, "dark")}</div></div>\n`,
  );
});

test("the same diagram twice on a page gets its own ids the second time", () => {
  const source = "graph TD\n  A --> B";
  const key = diagramKey(source);
  const html = render(`\`\`\`mermaid\n${source}\n\`\`\`\n\n\`\`\`mermaid\n${source}\n\`\`\``, {
    [key]: { light: svg(key, "light"), dark: svg(key, "dark") },
  });
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, 8);
  assert.ok(ids.includes(`mermaid-${key}-2-light_end`));
});

test("a Mermaid block with no rendered SVG fails instead of showing code", () => {
  assert.throws(() => render("```mermaid\ngraph TD\n```"), /Mermaid diagram [0-9a-f]{16} has no rendered SVG/);
});

test("Mermaid sources are found in quotes, callouts and notes", () => {
  const md = "```mermaid\na\n```\n\n> [!NOTE]\n> ```mermaid\n> b\n> ```\n\nx[^1]\n\n[^1]: n\n\n    ```Mermaid\n    c\n    ```\n\n```js\nd\n```";
  assert.deepEqual(mermaidSources(md), ["a", "b", "c"]);
});

test("a diagram is named by its %% title line", () => {
  assert.equal(diagramTitle("%% title: 發布流程\nflowchart LR\n  A --> B"), "發布流程");
  assert.equal(diagramTitle("flowchart LR\n  %% title 部署\n  A --> B"), "部署");
  assert.equal(diagramTitle("flowchart LR\n  A --> B"), "圖表");
});

test("a diagram SVG becomes an image with an escaped name", () => {
  const out = diagramSvg('<svg id="m" role="graphics-document document" aria-roledescription="flowchart-v2"><g></g></svg>', 'A "&" <B>');
  assert.equal(out, '<svg id="m" role="img" aria-label="A &quot;&amp;&quot; &lt;B&gt;"><g></g></svg>');
});

test("a diagram SVG that could run code or embed HTML is refused", () => {
  for (const bad of [
    "<svg><script>x</script></svg>",
    "<svg><foreignObject><div></div></foreignObject></svg>",
    '<svg onload="x"></svg>',
    '<svg><a href="https://evil.example/">x</a></svg>',
    '<svg><a xlink:href="javascript:x">x</a></svg>',
  ]) {
    assert.throws(() => diagramSvg(bad, "t"), /the SVG contains/, bad);
  }
  assert.doesNotThrow(() => diagramSvg('<svg><path marker-end="url(#m)"></path><use href="#m"></use></svg>', "t"));
});

test("plain text leaves out footnote and callout markers", () => {
  assert.equal(plainText("> [!NOTE]\n> 先讀這段[^1]。\n\n[^1]: 來源"), "先讀這段。 來源");
});
