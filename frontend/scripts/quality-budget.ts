// The pages and thresholds that the accessibility spec, check-budget.ts and
// lighthouse.ts all read from quality-budget.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Category = "performance" | "accessibility" | "best-practices" | "seo";

export interface BudgetPage {
  name: string;
  /** Relative to the site root, with the query string if the page needs one. */
  path: string;
  /** Raw and gzip bytes of the HTML plus the JS and CSS it loads. */
  size: { bytes: number; gzip: number };
  /** Lighthouse minimums for this page that differ from the site-wide ones. */
  minScores?: Partial<Record<Category, number>>;
}

export interface QualityBudget {
  pages: BudgetPage[];
  lighthouse: { runs: number; minScores: Record<Category, number> };
}

export const basePath = process.env.BASE_PATH ?? "/personal-blog";

export function loadBudget(): QualityBudget {
  return JSON.parse(readFileSync(join(import.meta.dirname, "..", "quality-budget.json"), "utf8"));
}
