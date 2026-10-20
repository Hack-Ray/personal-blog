import type { ArticleState } from "./api.ts";

export const STATE_LABEL: Record<ArticleState, string> = {
  draft: "草稿",
  published: "已發布",
  archived: "已封存",
  pending_deletion: "待刪除",
};
