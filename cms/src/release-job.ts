import type { ReleaseJob } from "./api.ts";

export const jobPending = (job: ReleaseJob): boolean => job.status === "queued" || job.status === "running";

export function jobMessage(job: ReleaseJob): string {
  switch (job.status) {
    case "queued": return "網站更新已排入佇列。可以離開此頁，稍後回來查看結果。";
    case "running": return "正在匯出並提交網站內容。可以繼續編輯文章。";
    case "failed": return job.detail || "網站更新失敗，請查看發布紀錄後重試。";
    case "completed": return job.release_id ? "內容提交作業已完成，建置與上線狀態請查看發布紀錄。" : "已發布的內容沒有變更，不需要更新網站。";
  }
}
