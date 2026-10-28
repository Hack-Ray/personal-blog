import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { loadBudget } from "../scripts/quality-budget.ts";

const THEMES = ["light", "dark"] as const;
const WIDTHS = { phone: 390, desktop: 1280 };

for (const [device, width] of Object.entries(WIDTHS)) {
  test.describe(device, () => {
    test.use({ viewport: { width, height: 844 } });

    for (const theme of THEMES) {
      for (const { name, path } of loadBudget().pages) {
        test(`${name} has no WCAG 2 A/AA violations in the ${theme} theme`, async ({ page }) => {
          await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
          await page.goto(path, { waitUntil: "networkidle" });
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
          expect(violations.map((v) => ({ rule: v.id, targets: v.nodes.map((n) => n.target.join(" ")) }))).toEqual([]);
        });
      }
    }
  });
}
