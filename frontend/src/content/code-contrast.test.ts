import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderMarkdown } from "./markdown.ts";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const codeBg = {
  light: /:root \{[^}]*--code-bg: (#\w{6})/.exec(css)![1]!,
  dark: /:root\[data-theme="dark"\] \{[^}]*--code-bg: (#\w{6})/.exec(css)![1]!,
};

const SNIPPETS = {
  ts: '// note\nconst n: number = 42;\nexport async function f<T>(x: T): Promise<string> { return `a${x}` + /re/.source; }\nclass A extends B { #p = true }',
  python: '# note\n@dec\ndef f(x: int = 1) -> None:\n    """doc"""\n    return f"{x}" + "s"\n',
  bash: '# note\nexport A="b"\nif [ -f "$A" ]; then echo $(ls) | grep -v x; fi\n',
  css: '/* note */\n.a > b:hover { color: #fff; margin: 0 auto; }\n@media (min-width: 1px) {}\n',
  yaml: "# note\nkey: value\nlist:\n  - 1\n  - true\n",
  json: '{"a": [1, null, "b"]}\n',
  diff: "@@ -1 +1 @@\n-old\n+new\n",
  html: '<!-- note -->\n<a href="x" class="y">z</a>\n',
  sql: "-- note\nSELECT a, count(*) FROM t WHERE b = 'x' GROUP BY a;\n",
};

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

test("highlighted code meets WCAG AA contrast on the code background in both themes", () => {
  const md = Object.entries(SNIPPETS).map(([lang, code]) => `\`\`\`${lang}\n${code}\`\`\``).join("\n\n");
  const html = renderMarkdown(md, "");
  for (const theme of ["light", "dark"] as const) {
    const colors = new Set([...html.matchAll(new RegExp(`--shiki-${theme}:(#\\w{6})`, "g"))].map((m) => m[1]!));
    assert.ok(colors.size >= 6, `${theme}: expected a varied palette, got ${[...colors]}`);
    const low = [...colors].filter((c) => contrast(c, codeBg[theme]) < 4.5).map((c) => `${c} ${contrast(c, codeBg[theme]).toFixed(2)}`);
    assert.deepEqual(low, [], `${theme} colors under 4.5:1 on ${codeBg[theme]}`);
  }
});
