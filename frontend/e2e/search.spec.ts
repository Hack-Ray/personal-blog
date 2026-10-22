import { expect, test, type Page, type Route } from "@playwright/test";
import { article, content } from "../test-fixtures/search.ts";
import { buildSearchAssets, type SearchAssets } from "../src/content/search-assets.ts";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function mockSearch(page: Page, assets: SearchAssets, handle: (route: Route, json: string, year: number) => Promise<void>) {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (/\/search-(?:metadata\.json|index\.json|data\/)/.test(request.url())) requested.push(new URL(request.url()).pathname);
  });
  await page.route("**/search-metadata.json", (route) => route.fulfill({ contentType: "application/json", body: assets.metadataJson }));
  await page.route("**/search-data/*/chunk.json", async (route) => {
    const asset = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const json = assets.chunks.get(asset)!;
    await handle(route, json, JSON.parse(json).year);
  });
  return requested;
}

for (const path of ["", "404.html"]) {
  test(`search does not download on ${path || "home"} before interaction`, async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (/\/search-(?:metadata\.json|index\.json|data\/)/.test(request.url())) requests.push(request.url());
    });
    await page.goto(path);
    if (path) await expect(page.locator("main li")).toHaveCount(3);
    await page.locator(".theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(requests).toEqual([]);
    await page.getByRole("searchbox").first().focus();
    await expect.poll(() => requests.some((url) => url.endsWith("/search-metadata.json"))).toBe(true);
  });
}

test("the search page adds body matches for an unchanged query as each year arrives", async ({ page }) => {
  const assets = buildSearchAssets(content(
    article("new", 2026, { title: "Recent article", markdown: "x".repeat(180) + " deepneedle" }),
    article("old", 2024, { title: "Older article", markdown: "x".repeat(180) + " deepneedle" }),
  ));
  const newest = gate();
  const oldest = gate();
  const requests = await mockSearch(page, assets, async (route, json, year) => {
    await (year === 2026 ? newest.promise : oldest.promise);
    await route.fulfill({ contentType: "application/json", body: json });
  });
  try {
    await page.goto("search/?q=deepneedle");
    const status = page.locator("main [role=status]");
    await expect(status).toContainText("目前 0 篇符合");
    await expect(status).toHaveAttribute("data-search-phase", "bodies");
    await expect.poll(() => requests.length).toBe(2);
    newest.release();
    await expect(page.locator("main .article-list li")).toHaveCount(1);
    await expect(status).toContainText("目前 1 篇符合");
    await expect(status).toContainText("1/2 年全文");
    await expect.poll(() => requests.length).toBe(3);
    oldest.release();
    await expect(status).toHaveText("2 篇符合");
    await expect(status).toHaveAttribute("data-search-phase", "complete");
    await expect(page.locator("main .article-list li")).toHaveCount(2);
    await expect(page.getByRole("searchbox").first()).toHaveValue("deepneedle");
  } finally {
    newest.release();
    oldest.release();
  }
});

test("the header reranks completed body matches and retains results through a failed year and retry", async ({ page }) => {
  const assets = buildSearchAssets(content(
    article("new", 2026, { title: "Needle recent", markdown: "recent" }),
    article("old", 2024, { title: "Needle older", markdown: "x".repeat(180) + " needle" }),
  ));
  let olderAttempts = 0;
  const requests = await mockSearch(page, assets, async (route, json, year) => {
    if (year === 2024 && ++olderAttempts === 1) await route.fulfill({ status: 503, body: "unavailable" });
    else await route.fulfill({ contentType: "application/json", body: json });
  });
  await page.goto("");
  await page.getByRole("searchbox").first().fill("needle");
  const preview = page.locator(".search-preview");
  const status = preview.getByRole("status");
  await expect(status).toHaveAttribute("data-search-phase", "body-error");
  await expect(status).toContainText("目前 2 篇符合");
  await expect(status).toContainText("結果尚未完整");
  await expect(preview.locator("li a").first()).toHaveText("Needle recent");
  await expect(preview.getByRole("button", { name: "重新載入頁面" })).toBeVisible();
  await preview.getByRole("button", { name: "重試搜尋" }).click();
  await expect(status).toHaveAttribute("data-search-phase", "complete");
  await expect(status).toHaveText("2 篇符合");
  await expect(preview.locator("li a").first()).toHaveText("Needle older");
  expect(requests.filter((url) => url.endsWith("/search-metadata.json"))).toHaveLength(1);
  expect(requests.filter((url) => url.includes("/2026-"))).toHaveLength(1);
  expect(requests.filter((url) => url.includes("/2024-"))).toHaveLength(2);
});

test("header and search page share downloads across client navigation and keep query history working", async ({ page }) => {
  const assets = buildSearchAssets(content(...Array.from({ length: 6 }, (_, i) => article(`post${i}`, 2026, { title: `Needle ${i}` }))));
  const pending = gate();
  const requests = await mockSearch(page, assets, async (route, json) => {
    await pending.promise;
    await route.fulfill({ contentType: "application/json", body: json });
  });
  try {
    await page.goto("");
    const box = page.getByRole("searchbox").first();
    await box.fill("needle");
    await page.locator(".search-preview").getByRole("link", { name: "查看全部 6 篇" }).click();
    await expect(page).toHaveURL(/\/search\/\?q=needle/);
    await expect(page.locator("main .article-list li")).toHaveCount(6);
    await expect(page.locator("main [role=status]")).toHaveAttribute("data-search-phase", "bodies");
    expect(requests).toHaveLength(2);
    pending.release();
    await expect(page.locator("main [role=status]")).toHaveText("6 篇符合");
    await box.fill("needle 3");
    await expect(page).toHaveURL(/q=needle%203/);
    await expect(page.locator("main .article-list li")).toHaveCount(1);
    await page.evaluate(() => {
      history.pushState(null, "", "?q=needle");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(box).toHaveValue("needle");
    await expect(page.locator("main .article-list li")).toHaveCount(6);
    expect(requests).toHaveLength(2);
  } finally {
    pending.release();
  }
});

test("metadata failures can retry and the reload control navigates without starting another retry", async ({ page }) => {
  let attempts = 0;
  const empty = buildSearchAssets(content()).metadataJson;
  await page.route("**/search-metadata.json", async (route) => {
    attempts++;
    await route.fulfill(attempts <= 2
      ? { status: 503, body: "unavailable" }
      : { contentType: "application/json", body: empty });
  });
  await page.goto("");
  const box = page.getByRole("searchbox").first();
  await box.fill("needle");
  const preview = page.locator(".search-preview");
  await expect(preview.getByRole("status")).toHaveAttribute("data-search-phase", "metadata-error");
  await expect(preview.getByRole("status")).not.toContainText("0 篇符合");
  await preview.getByRole("button", { name: "重試搜尋" }).click();
  await expect.poll(() => attempts).toBe(2);
  await expect(preview.getByRole("status")).toHaveAttribute("data-search-phase", "metadata-error");
  await Promise.all([
    page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame()),
    preview.getByRole("button", { name: "重新載入頁面" }).click(),
  ]);
  expect(attempts).toBe(2);
  await page.waitForLoadState("load");
  await box.fill("needle");
  await expect(preview.getByRole("status")).toHaveAttribute("data-search-phase", "complete");
  await expect(preview.getByRole("status")).toHaveText("0 篇符合");
  expect(attempts).toBe(3);
});
