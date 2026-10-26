import { ApiError } from "./api.ts";
import { isSlug } from "./taxa.ts";

const MAX_LENGTH = 80;
// /posts/page/<n>/ is the article list on the public site.
const RESERVED = new Set(["page"]);

export type SlugStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "taken"; suggestion: string }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

export const publicPath = (docId: string, slug: string | null) => `/posts/${slug ?? docId}/`;

export function slugProblem(slug: string): string | undefined {
  if (slug.length > MAX_LENGTH) return `slug 最多 ${MAX_LENGTH} 個字元`;
  if (!isSlug(slug)) return "slug 只能用英文小寫、數字與 -，且不能以 - 開頭、結尾或連續兩個 -";
  if (RESERVED.has(slug)) return `${slug} 是保留字，請換一個`;
}

/** What leaving the slug input does: nothing when it is unchanged, else show the problem or save. Empty clears the slug. */
export function onSlugBlur(
  input: string,
  saved: string | null,
): { kind: "none" } | { kind: "save"; slug: string | null } | { kind: "invalid"; message: string } {
  const slug = input.trim() || null;
  if (slug === saved) return { kind: "none" };
  const problem = slug === null ? undefined : slugProblem(slug);
  return problem ? { kind: "invalid", message: problem } : { kind: "save", slug };
}

export function slugSaveFailed(e: unknown): SlugStatus {
  if (e instanceof ApiError && e.status === 409 && typeof e.body.suggestion === "string") return { kind: "taken", suggestion: e.body.suggestion };
  if (e instanceof ApiError && e.status === 422) return { kind: "invalid", message: e.message };
  return { kind: "error", message: e instanceof Error ? e.message : String(e) };
}
