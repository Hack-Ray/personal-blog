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
