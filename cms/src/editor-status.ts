import type { DraftContent, Taxon } from "./api.ts";
import type { SyncStatus } from "./draft-sync.ts";
import { isSlug } from "./taxa.ts";

const STATUS_TEXT: Record<SyncStatus["kind"], string> = {
  saved: "已儲存",
  dirty: "尚未儲存",
  saving: "儲存中…",
  publishing: "發布中…",
  conflict: "草稿已在其他地方被修改",
  error: "儲存失敗",
};

/** Why the editor must not hand this content to DraftSync, if it must not. */
export function unsavedReason(content: DraftContent): string | undefined {
  if (!isSlug(content.topic.slug) || content.topic.name.trim() === "") return "Topic 不合法";
}

const sameTaxon = (a: Taxon, b: Taxon) => a.slug === b.slug && a.name === b.name;

const sameContent = (a: DraftContent, b: DraftContent) =>
  a.title === b.title &&
  a.markdown === b.markdown &&
  sameTaxon(a.topic, b.topic) &&
  a.tags.length === b.tags.length &&
  a.tags.every((t, i) => sameTaxon(t, b.tags[i]!));

/** `synced` is the content DraftSync last received; `content` is what the author sees. */
export function statusLabel(
  status: SyncStatus,
  content: DraftContent,
  synced: DraftContent,
): { kind: SyncStatus["kind"] | "unsaved"; text: string } {
  const reason = unsavedReason(content);
  if (status.kind !== "conflict" && reason && !sameContent(content, synced)) {
    return { kind: "unsaved", text: `未儲存：${reason}` };
  }
  const text = status.kind === "error" ? `${STATUS_TEXT.error}：${status.message}` : STATUS_TEXT[status.kind];
  return { kind: status.kind, text };
}
