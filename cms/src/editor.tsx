import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Draft, type DraftContent } from "./api.ts";
import { DraftSync, type SyncStatus } from "./draft-sync.ts";
import { STATE_LABEL } from "./labels.ts";
import { formatTags, isSlug, parseTags } from "./taxa.ts";

const STATUS_TEXT: Record<SyncStatus["kind"], string> = {
  saved: "已儲存",
  dirty: "尚未儲存",
  saving: "儲存中…",
  publishing: "發布中…",
  conflict: "草稿已在其他地方被修改",
  error: "儲存失敗",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Editor({ draft, onReload }: { draft: Draft; onReload: () => void }) {
  const [content, setContent] = useState<DraftContent>(draft);
  const [tagText, setTagText] = useState(formatTags(draft.tags));
  const [status, setStatus] = useState<SyncStatus>({ kind: "saved" });
  const [notice, setNotice] = useState("");
  const [state, setState] = useState(draft.state);
  const sync = useRef<DraftSync>(null);

  useEffect(() => {
    sync.current = new DraftSync(api, draft.doc_id, { revision: draft.revision, content: draft }, setStatus);
    return () => void sync.current?.flush();
  }, [draft]);

  const { invalid } = parseTags(tagText);
  const topicValid = isSlug(content.topic.slug) && content.topic.name.trim() !== "";

  const update = (next: DraftContent) => {
    setContent(next);
    if (isSlug(next.topic.slug) && next.topic.name.trim()) sync.current?.edit(next);
  };

  const publish = async () => {
    const result = await sync.current?.publish();
    if (!result) return;
    setState("published");
    setNotice(`已發布第 ${result.version} 版。執行 Exporter 後才會出現在網站上。`);
  };

  const preview = useMemo(() => marked.parse(content.markdown, { async: false }), [content.markdown]);

  return (
    <div className="editor">
      <div className="toolbar">
        <a href="#/">← 文章列表</a>
        <span className={`status status-${status.kind}`} role="status">
          {STATUS_TEXT[status.kind]}
          {status.kind === "error" && `：${status.message}`}
        </span>
        <span className="state">{STATE_LABEL[state]}</span>
        <button type="button" onClick={publish} disabled={status.kind === "conflict" || !topicValid}>
          發布
        </button>
      </div>
      {status.kind === "conflict" && (
        <p className="banner">
          伺服器上的草稿已是第 {status.currentRevision} 版，這裡的修改不會再自動儲存。
          <button type="button" onClick={onReload}>
            重新載入
          </button>
        </p>
      )}
      {notice && <p className="banner ok">{notice}</p>}
      <div className="meta-fields">
        <Field label="標題">
          <input value={content.title} onChange={(e) => update({ ...content, title: e.target.value })} />
        </Field>
        <Field label="Topic slug">
          <input
            value={content.topic.slug}
            aria-invalid={!isSlug(content.topic.slug)}
            onChange={(e) => update({ ...content, topic: { ...content.topic, slug: e.target.value } })}
          />
        </Field>
        <Field label="Topic 名稱">
          <input
            value={content.topic.name}
            onChange={(e) => update({ ...content, topic: { ...content.topic, name: e.target.value } })}
          />
        </Field>
        <Field label="Tags（slug:名稱, …）">
          <input
            value={tagText}
            aria-invalid={invalid.length > 0}
            onChange={(e) => {
              setTagText(e.target.value);
              update({ ...content, tags: parseTags(e.target.value).tags });
            }}
          />
        </Field>
      </div>
      {invalid.length > 0 && <p className="hint">無效的 tag slug：{invalid.join("、")}</p>}
      <div className="split">
        <textarea
          aria-label="Markdown"
          value={content.markdown}
          onChange={(e) => update({ ...content, markdown: e.target.value })}
          spellCheck={false}
        />
        {/* Preview of the author's own Markdown, same renderer as the public site. */}
        <div className="preview" dangerouslySetInnerHTML={{ __html: preview }} />
      </div>
    </div>
  );
}
