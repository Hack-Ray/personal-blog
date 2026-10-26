import { expect, test } from "@playwright/test";

// Runs against the build of sample-site-data.
const FASTAPI_POST = "posts/01K7M4Y7P65BDCF8AHRTQY7ZQF/";

test("the header search previews matches and opens the search page", async ({ page }) => {
  await page.goto("");
  const box = page.getByRole("searchbox", { name: "搜尋文章" }).first();
  await box.fill("FastAPI");
  const preview = page.locator(".search-preview");
  await expect(preview).toContainText("1 篇符合");
  await expect(preview.getByRole("link", { name: /用 FastAPI 打造/ })).toBeVisible();
  await box.press("Enter");
  await expect(page).toHaveURL(/\/search\/\?q=FastAPI/);
  await expect(page.locator("main")).toContainText("用 FastAPI 打造個人部落格的後端");
});

test("a header search result opens its post when tapped", async ({ page }) => {
  await page.goto("");
  const box = page.getByRole("searchbox", { name: "搜尋文章" }).first();
  await box.fill("FastAPI");
  const preview = page.locator(".search-preview");
  // Safari doesn't focus a tapped link, so the box blurs with no relatedTarget before the click.
  await box.evaluate((el: HTMLInputElement) => el.blur());
  await preview.getByRole("link", { name: /用 FastAPI 打造/ }).click();
  await expect(page).toHaveURL(new RegExp(FASTAPI_POST));
});

test("an earlier URL of a post redirects to its slug URL", async ({ page }) => {
  await page.goto("posts/01K7P2B9X3QW8N5R7TZ4HJMVCD/");
  await expect(page).toHaveURL(/\/personal-blog\/posts\/nextjs-static-export\/$/);
  await expect(page.locator("h1")).toHaveText("Next.js Static Export 部署到 GitHub Pages");
});

test("a search result links to the post's slug URL", async ({ page }) => {
  await page.goto("search/?q=GitHub%20Pages");
  await page.getByRole("link", { name: "Next.js Static Export 部署到 GitHub Pages" }).click();
  await expect(page).toHaveURL(/\/posts\/nextjs-static-export\/$/);
});

test("the header search preview closes on a tap outside it", async ({ page }) => {
  await page.goto("");
  const box = page.getByRole("searchbox", { name: "搜尋文章" }).first();
  await box.fill("FastAPI");
  const preview = page.locator(".search-preview");
  await expect(preview).toBeVisible();
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await expect(preview).toBeHidden();
});

test("the theme toggle cycles and survives a reload", async ({ page }) => {
  await page.goto("");
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-theme");
  const toggle = page.locator(".theme-toggle");
  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
});

test("code blocks copy their code", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(FASTAPI_POST);
  const copy = page.locator(".copy-code").first();
  // The button stays hidden until the page's script can make it work.
  await expect(copy).not.toHaveAttribute("hidden");
  await page.locator(".code-block").first().hover();
  await copy.click();
  await expect(copy).toHaveText("已複製");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("app = FastAPI()");
});

test("body images open in a dialog that closes on click or Escape", async ({ page }) => {
  await page.goto(FASTAPI_POST);
  const image = page.locator(".article-body figure img").first();
  const dialog = page.locator("dialog.image-zoom");
  await image.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await image.click();
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
});

test("the back-to-top button appears after scrolling and returns to the top", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(FASTAPI_POST);
  // Hidden from assistive tech until shown, so getByRole would not find it.
  const top = page.locator(".back-to-top");
  await expect(top).toHaveAttribute("aria-hidden", "true");
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect(top).toHaveAttribute("aria-hidden", "false");
  await top.click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test("the archive switches between newest and oldest first", async ({ page }) => {
  await page.goto("archive/");
  const first = page.locator(".archive-list a").first();
  await expect(first).toHaveText("Next.js Static Export 部署到 GitHub Pages");
  await page.getByRole("button", { name: "由新到舊" }).click();
  await expect(first).toHaveText("沒有標籤的短文");
});

test("the 404 page lists the latest posts", async ({ page }) => {
  await page.goto("404.html");
  await expect(page.getByRole("heading", { name: "最新文章" })).toBeVisible();
  await expect(page.locator("main li")).toHaveCount(3);
});

for (const path of ["", FASTAPI_POST, "archive/"]) {
  test(`no horizontal scrolling at phone width: /${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
}

test("the table of contents sits beside the article on wide screens and highlights the current section", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto(FASTAPI_POST);
  const toc = page.getByRole("navigation", { name: "目錄" });
  await expect(toc).toBeVisible();
  await expect(page.getByRole("button", { name: "☰ 目錄" })).toBeHidden();
  const links = toc.getByRole("link");
  await expect(links.first()).toHaveAttribute("aria-current", "location");
  await links.nth(2).click();
  await expect(links.nth(2)).toHaveAttribute("aria-current", "location");
  await expect(links.first()).not.toHaveAttribute("aria-current", "location");
  await expect(toc).toBeVisible();
});

test("the table of contents is a drawer on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(FASTAPI_POST);
  const toc = page.getByRole("navigation", { name: "目錄" });
  const toggle = page.getByRole("button", { name: "☰ 目錄" });
  await expect(toc).toBeHidden();
  await toggle.click();
  await expect(toc).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toc).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  const target = toc.getByRole("link").nth(2);
  const id = (await target.getAttribute("href"))!.slice(1);
  await target.click();
  await expect(toc).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#${encodeURIComponent(id)}$`));
  await toggle.click();
  await expect(target).toHaveAttribute("aria-current", "location");
});

test("an article page carries one BlogPosting JSON-LD whose headline is the h1", async ({ page }) => {
  await page.goto(FASTAPI_POST);
  const scripts = page.locator('script[type="application/ld+json"]');
  await expect(scripts).toHaveCount(1);
  const data = JSON.parse((await scripts.textContent()) ?? "");
  expect(data["@type"]).toBe("BlogPosting");
  expect(data.headline).toBe(await page.locator("h1").innerText());
});

test("the home page carries a WebSite JSON-LD and no Search Console tag by default", async ({ page }) => {
  await page.goto("");
  const scripts = page.locator('script[type="application/ld+json"]');
  await expect(scripts).toHaveCount(1);
  expect(JSON.parse((await scripts.textContent()) ?? "")["@type"]).toBe("WebSite");
  await expect(page.locator('meta[name="google-site-verification"]')).toHaveCount(0);
});

test("a post offers share links to its slug URL and copies it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("posts/nextjs-static-export/");
  const share = page.getByRole("region", { name: "分享這篇文章" });
  const url = "https://example.com/personal-blog/posts/nextjs-static-export/";
  const facebook = await share.getByRole("link", { name: "分享到 Facebook" }).getAttribute("href");
  expect(new URL(facebook!).searchParams.get("u")).toBe(url);
  await expect(share.getByRole("link", { name: "分享到 LINE" })).toHaveAttribute("target", "_blank");
  await share.getByRole("button", { name: "複製連結" }).click();
  await expect(share.getByRole("button", { name: "已複製" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("the Facebook button opens the system share sheet instead of the app", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { shared?: ShareData };
      navigator.share = async (data) => void (w.shared = data);
    });
    await page.goto("posts/nextjs-static-export/");
    await page.getByRole("link", { name: "分享到 Facebook" }).click();
    const shared = await page.evaluate(() => (window as unknown as { shared?: ShareData }).shared);
    expect(shared?.url).toBe("https://example.com/personal-blog/posts/nextjs-static-export/");
    expect(page.context().pages()).toHaveLength(1);
  });
});
