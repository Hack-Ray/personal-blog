import type { Release } from "./api.ts";

export const SLOW_AFTER_MINUTES = 10;
const PENDING: Release["status"][] = ["dispatched", "building"];

/** Whether a release has waited on GitHub for SLOW_AFTER_MINUTES or more. */
export function isSlow(releases: Release[], now: Date): boolean {
  const limit = SLOW_AFTER_MINUTES * 60 * 1000;
  return releases.some((r) => PENDING.includes(r.status) && now.getTime() - new Date(r.created_at).getTime() >= limit);
}
