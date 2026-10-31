// Signs in to the verification CMS and screenshots routes at phone and desktop width.
//   node .claude/skills/verify/scripts/shots.mjs [out-dir] [route ...]
// Routes are names from ROUTES below (default: all). Prints one line per shot
// with the horizontal overflow in CSS px; exits 1 if any page overflows.
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const { chromium } = await import(join(repo, "frontend/node_modules/playwright/index.mjs"));
const state = join(repo, ".audit/verify/instance");
const base = readFileSync(join(state, "url"), "utf8");
const password = readFileSync(join(state, "password"), "utf8");

const [outArg, ...only] = process.argv.slice(2);
const out = outArg ?? join(repo, ".audit/verify", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(out, { recursive: true });

const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
const ROUTES = {
  list: () => "#/",
  edit: (a) => `#/edit/${a.doc_id}`,
  new: () => "#/new",
  profile: () => "#/profile",
  taxa: () => "#/taxa",
  releases: () => "#/releases",
  analytics: () => "#/analytics",
};
const names = only.length ? only : Object.keys(ROUTES);

const browser = await chromium.launch();
let overflowed = false;
for (const [size, viewport] of Object.entries(SIZES)) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: "light" });
  const signIn = await context.request.post(`${base}/api/session`, { data: { password } });
  if (!signIn.ok()) throw new Error(`sign-in returned ${signIn.status()}`);
  const list = await (await context.request.get(`${base}/api/articles`)).json();
  const article = (list.items ?? list)[0];
  const page = await context.newPage();
  for (const name of names) {
    if (name === "edit" && !article) {
      console.log(`${size} edit: skipped, the database has no articles`);
      continue;
    }
    await page.goto(`${base}/admin/${ROUTES[name](article)}`);
    // A hash change alone does not reload the SPA, so a fresh load picks up the session.
    await page.reload();
    await page.waitForLoadState("networkidle");
    if (await page.getByRole("heading", { name: "登入 CMS" }).count()) throw new Error(`${name}: still on the sign-in page`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const file = join(out, `${size}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    if (overflow > 0) overflowed = true;
    console.log(`${size} ${name}: overflow ${overflow}px -> ${file}`);
  }
  await context.close();
}
await browser.close();
process.exit(overflowed ? 1 : 0);
