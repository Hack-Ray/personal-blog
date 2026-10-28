import { expect, test } from "@playwright/test";

// The sample post that uses footnotes, callouts and a Mermaid diagram.
const POST = "posts/nextjs-static-export/";
const DIAGRAM = "從 Snapshot 到 GitHub Pages 的建置流程";

test("a footnote reference jumps to its note, and the note links back", async ({ page }) => {
  await page.goto(POST);
  await page.locator("sup.footnote-ref a").first().click();
  await expect(page).toHaveURL(/#fn_1$/);
  const note = page.locator("#fn_1");
  await expect(note).toBeInViewport();
  await expect(note).toContainText("也不能設定回應標頭");
  await expect(page.getByRole("heading", { name: "註腳" })).toBeVisible();
  await note.getByRole("link", { name: "回到註腳 1 的引用處" }).click();
  await expect(page).toHaveURL(/#fnref_1$/);
  await expect(page.locator("#fnref_1")).toBeInViewport();
});

test("a callout shows its label", async ({ page }) => {
  await page.goto(POST);
  const note = page.locator(".callout-note");
  await expect(note).toHaveAttribute("role", "note");
  await expect(note.locator(".callout-title")).toHaveText("注意");
  await expect(note).toContainText("靜態匯出不支援需要伺服器的功能");
  await expect(page.locator(".callout-warning .callout-title")).toHaveText("警告");
});

test("a Mermaid diagram is an inline SVG image and the page loads no Mermaid script", async ({ page }) => {
  const scripts: string[] = [];
  page.on("response", async (r) => {
    if (r.request().resourceType() === "script") scripts.push(`${r.url()}\n${await r.text()}`);
  });
  await page.goto(POST);
  await page.waitForLoadState("networkidle");
  const diagram = page.getByRole("img", { name: DIAGRAM });
  await expect(diagram).toBeVisible();
  expect(await diagram.evaluate((el) => el.tagName)).toBe("svg");
  expect(await diagram.locator("text").count()).toBeGreaterThan(0);
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.filter((s) => /mermaid/i.test(s))).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the diagram shows its ${scheme} variant for a ${scheme} system theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(POST);
    await expect(page.locator(`.diagram-${scheme} svg`)).toBeVisible();
    await expect(page.locator(`.diagram-${scheme === "light" ? "dark" : "light"} svg`)).toBeHidden();
  });
}

test("the diagram follows the theme toggle over the system theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(POST);
  const toggle = page.locator(".theme-toggle");
  await toggle.click();
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".diagram-dark svg")).toBeVisible();
  await expect(page.locator(".diagram-light svg")).toBeHidden();
  await page.emulateMedia({ colorScheme: "dark" });
  await toggle.click();
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".diagram-light svg")).toBeVisible();
  await expect(page.locator(".diagram-dark svg")).toBeHidden();
});
