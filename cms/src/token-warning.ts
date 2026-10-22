const time = new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short" });
const WARN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A warning when the CMS's GitHub token expires within WARN_DAYS, or "" when it is fine or unknown. */
export function tokenWarning(expiresAt: string | null, now: Date): string {
  if (!expiresAt) return "";
  const days = Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS);
  if (days <= 0) return "CMS 的 GitHub token 已過期，「更新網站」無法啟動部署。請依 docs/fork-and-deploy.md 第 4 步換一個新的 token。";
  if (days > WARN_DAYS) return "";
  return `CMS 的 GitHub token 將在 ${days} 天後（${time.format(new Date(expiresAt))}）過期。請依 docs/fork-and-deploy.md 第 4 步換一個新的 token。`;
}
