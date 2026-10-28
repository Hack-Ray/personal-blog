import { expect, test } from "@playwright/test";

// Runs against the build of sample-site-data.
test("an article without a cover shares a 1200x630 image drawn from its title", async ({ page, request }) => {
  await page.goto("posts/nextjs-static-export/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://example.com/personal-blog/og/01K7P2B9X3QW8N5R7TZ4HJMVCD.png",
  );
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  const response = await request.get("og/01K7P2B9X3QW8N5R7TZ4HJMVCD.png");
  expect(response.headers()["content-type"]).toBe("image/png");
  const png = await response.body();
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
});

test("an article with a cover keeps sharing the cover", async ({ page }) => {
  await page.goto("posts/01K7M4Y7P65BDCF8AHRTQY7ZQF/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/personal-blog\/images\/[0-9a-f]+\.webp$/);
});

test("the home page keeps the default share image", async ({ page }) => {
  await page.goto("");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://example.com/personal-blog/og-default.png");
});
