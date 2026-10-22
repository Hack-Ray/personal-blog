import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  assert(args[index + 1] && !args[index + 1].startsWith("--"), `${name} needs a value`);
  return args[index + 1];
};
if (args.includes("--help")) {
  console.log("node frontend/scripts/bench-search-generate.mjs --out /tmp/search-snapshot [--seed 20261022] [--repo /path/to/repo]");
  process.exit(0);
}
const output = option("--out");
assert(output, "Pass --out to an empty directory or a previous generated snapshot");
const out = resolve(output);
const sourceRoot = resolve(option("--repo", repo));
const seed = Number(option("--seed", "20261022"));
assert(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, "seed must be an unsigned 32-bit integer");
const marker = join(out, "bench-search-corpus.json");
let existing = [];
try { existing = readdirSync(out); } catch (error) { if (error.code !== "ENOENT") throw error; }
assert(existing.length === 0 || existing.includes("bench-search-corpus.json"), "Refusing to replace a directory without a generated corpus manifest");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith(".md") ? [path] : [];
  }).sort();
}
const sourceFiles = files(join(sourceRoot, "docs"));
const corpus = sourceFiles.map((path) => ({ path: relative(sourceRoot, path), text: readFileSync(path, "utf8") }));
const paragraphs = [...new Set(corpus.flatMap(({ text }) => text
  .replace(/```[\s\S]*?```/g, "\n\n")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .split(/\n\s*\n/)
  .filter((block) => !/^\s*(?:#|\||>|---)/m.test(block))
  .map((block) => block.replace(/^\s*(?:[-*+] |\d+[.)] )/gm, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim())
  .filter((block) => block.length >= 40 && block.length <= 900 && (block.match(/\p{Script=Han}/gu)?.length ?? 0) >= 20 && !/<\/?[a-z]/i.test(block))))];
assert(paragraphs.length >= 30, `Need at least 30 Chinese prose paragraphs, found ${paragraphs.length}`);
let state = seed;
function random() {
  state = (state + 0x6d2b79f5) | 0;
  let value = Math.imul(state ^ (state >>> 15), 1 | state);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}
const topicNames = ["後端設計", "前端開發", "資料模型", "發布流程", "靜態網站", "搜尋功能", "測試實務", "部署維運", "安全設計", "介面體驗", "效能分析", "版本管理", "內容管理", "資料備份", "系統架構", "程式品質", "錯誤處理", "自動化工具", "文件整理", "網站導覽"];
const tagNames = ["資料庫", "交易", "索引", "查詢", "快照", "發布", "建置", "靜態匯出", "路由", "快取", "載入", "搜尋", "中文", "標題", "內文", "分類", "標籤", "文章", "封存", "草稿", "驗證", "測試", "瀏覽器", "行動裝置", "桌面", "網路", "壓縮", "傳輸", "延遲", "記憶體", "排序", "分頁", "摘要", "目錄", "連結", "導覽", "設定", "環境變數", "部署", "權限", "帳號", "憑證", "備份", "還原", "版本", "遷移", "錯誤", "重試", "日誌", "監控", "自動化", "指令", "工具", "文件", "規格", "模型", "介面", "元件", "可用性", "維護"];
const topics = topicNames.map((name, i) => ({ slug: `topic-${i + 1}`, name }));
const tags = tagNames.map((name, i) => ({ slug: `tag-${i + 1}`, name }));
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function docId(number) {
  let suffix = "";
  for (let value = number + 1; value > 0; value = Math.floor(value / 32)) suffix = alphabet[value % 32] + suffix;
  return "01BENCH" + suffix.padStart(19, "0");
}
const probes = {
  title: { query: "漸進搜尋標題驗證", docId: docId(999) },
  body: { query: "封存年度內文探針", docId: docId(0), year: 2023 },
};
const articles = Array.from({ length: 1000 }, (_, i) => {
  const target = i === 0 ? 1500 : i === 1 ? 8500 : Math.max(1500, Math.round(1300 + (random() + random()) * 3300));
  const parts = [];
  let length = 0;
  while (length < target) {
    const paragraph = paragraphs[Math.floor(random() * paragraphs.length)];
    parts.push(paragraph);
    length += paragraph.length + (parts.length > 1 ? 2 : 0);
  }
  let markdown = parts.join("\n\n");
  if (i === 0) {
    let insertion = 0;
    let prefixLength = 0;
    while (prefixLength < 600 && insertion < parts.length) prefixLength += parts[insertion++].length + 2;
    parts.splice(insertion, 0, `這份舊年度紀錄用${probes.body.query}確認讀者能找到較早發布的完整文章。`);
    markdown = parts.join("\n\n");
  }
  if (markdown.length > 8500) {
    const end = markdown.slice(0, 8500).search(/[。！？][^。！？]*$/u);
    markdown = markdown.slice(0, end >= 1500 ? end + 1 : 8500);
  }
  const published = new Date(Date.UTC(2023, 0, 1) + Math.floor(i * 1460 / 1000) * 86400000);
  return {
    doc_id: docId(i), version: 1,
    title: `${i === 999 ? `${probes.title.query}：` : ""}${topics[i % 20].name}的設計紀錄 ${String(i + 1).padStart(4, "0")}`,
    topic: topics[i % 20], tags: [tags[i % 60], tags[(i + 19) % 60], tags[(i + 41) % 60]],
    published_at: published.toISOString(), markdown,
    excerpt: `${topics[i % 20].name}的實作筆記，整理專案文件中的需求、限制與操作流程。`,
  };
});
for (const [kind, probe] of Object.entries(probes)) {
  const matches = articles.filter((article) => kind === "title" ? article.title.includes(probe.query) : article.markdown.includes(probe.query));
  assert.equal(matches.length, 1, `${kind} probe must identify exactly one post`);
  assert.equal(matches[0].doc_id, probe.docId);
  probe.title = matches[0].title;
  assert(!JSON.stringify([matches[0].topic, matches[0].tags, matches[0].excerpt]).includes(probe.query));
  if (kind === "body") {
    assert(!matches[0].title.includes(probe.query));
    assert(matches[0].markdown.replace(/\s+/g, " ").indexOf(probe.query) >= 400, "body probe must not occur in the 160-character metadata preview");
    assert(matches[0].markdown.indexOf(probe.query) < 4500, "body probe must survive the 5000-character index limit");
    probe.offset = matches[0].markdown.indexOf(probe.query);
  }
}
const lengths = articles.map((article) => article.markdown.length).sort((a, b) => a - b);
assert.equal(new Set(articles.map((article) => article.topic.slug)).size, 20);
assert.equal(new Set(articles.flatMap((article) => article.tags.map((tag) => tag.slug))).size, 60);
assert.equal(new Set(articles.map((article) => article.published_at.slice(0, 4))).size, 4);
assert(lengths[0] >= 1500 && lengths.at(-1) <= 8500);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const manifest = {
  schema_version: 1, release_id: docId(1000), created_at: "2026-12-31T00:00:00.000Z",
  articles: articles.map((article) => ({ doc_id: article.doc_id, version: article.version })), archived_articles: [],
};
for (const id of [manifest.release_id, ...articles.map((article) => article.doc_id)]) assert(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id), `Invalid ULID ${id}`);
const profile = { name: "搜尋效能測試", headline: "專案文件語料", intro: "用固定種子與專案中文文件建立的文章快照。", links: [], experience: [], projects: [], site: { title: "搜尋效能測試", description: "一千篇中文技術文章", footer: "" } };
mkdirSync(out, { recursive: true });
rmSync(join(out, "articles"), { recursive: true, force: true });
mkdirSync(join(out, "articles"));
for (const article of articles) writeFileSync(join(out, "articles", `${article.doc_id}.json`), json(article));
writeFileSync(join(out, "manifest.json"), json(manifest));
writeFileSync(join(out, "profile.json"), json(profile));
const corpusManifest = {
  schemaVersion: 1, generator: "bench-search-generate.mjs", seed, articleCount: articles.length,
  topicCount: topics.length, tagCount: tags.length, years: [2023, 2024, 2025, 2026], images: 0,
  characters: { min: lengths[0], median: (lengths[499] + lengths[500]) / 2, max: lengths.at(-1), total: lengths.reduce((sum, length) => sum + length, 0) },
  paragraphCount: paragraphs.length,
  sourceCorpus: corpus.map(({ path, text }) => ({ path, sha256: sha256(text), bytes: Buffer.byteLength(text) })),
  snapshotSha256: sha256(json(manifest) + json(profile) + articles.map(json).join("")),
  probes,
};
writeFileSync(marker, json(corpusManifest));
console.log(JSON.stringify({ directory: out, ...corpusManifest }, null, 2));
