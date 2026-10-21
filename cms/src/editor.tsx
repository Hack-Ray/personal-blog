import { useEffect, useMemo, useRef, useState } from "react";
import { SIGNED_IN, api, type Draft, type DraftContent } from "./api.ts";
import { DraftSync, type SyncStatus } from "./draft-sync.ts";
import { statusLabel, unsavedReason } from "./editor-status.ts";
import { STATE_LABEL } from "./labels.ts";
import { renderPreview } from "./preview.ts";
import { SnapshotPanel } from "./snapshot-panel.tsx";
import { formatTags, isSlug, parseTags } from "./taxa.ts";

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
  const [uploading, setUploading] = useState(0);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const sync = useRef<DraftSync>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sync.current = new DraftSync(api, draft.doc_id, { revision: draft.revision, content: draft }, setStatus);
    const retry = () => void sync.current?.flush();
    addEventListener(SIGNED_IN, retry);
    return () => {
      removeEventListener(SIGNED_IN, retry);
      void sync.current?.flush();
    };
  }, [draft]);

  const { invalid } = parseTags(tagText);
  const topicValid = unsavedReason(content) === undefined;
  const label = statusLabel(status, content, sync.current?.current ?? draft);

  const update = (next: DraftContent) => {
    setContent(next);
    if (unsavedReason(next) === undefined) sync.current?.edit(next);
  };

  const publish = async () => {
    const result = await sync.current?.publish();
    if (!result) return;
    setState("published");
    setNotice(`已發布第 ${result.version} 版。到「網站發布」更新網站後才會出現在網站上。`);
  };

  const latest = useRef(content);
  latest.current = content;

  const insertImages = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setUploadError("");
    setUploading((n) => n + images.length);
    for (const file of images) {
      try {
        const { markdown } = await api.uploadImage(file);
        const el = textarea.current;
        const md = latest.current.markdown;
        const at = el ? el.selectionStart : md.length;
        const snippet = `${at > 0 && md[at - 1] !== "\n" ? "\n" : ""}${markdown}\n`;
        update({ ...latest.current, markdown: md.slice(0, at) + snippet + md.slice(at) });
        requestAnimationFrame(() => el?.setSelectionRange(at + snippet.length, at + snippet.length));
      } catch (e) {
        setUploadError(`${file.name}：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const restore = async (snapshotId: number) => {
    const restored = await sync.current?.restoreSnapshot(snapshotId);
    if (!restored) return;
    setContent(sync.current!.current);
    setShowSnapshots(false);
    setNotice("已還原快照。");
  };

  const preview = useMemo(() => renderPreview(content.markdown), [content.markdown]);

  return (
    <div className="editor">
      <div className="toolbar">
        <a href="#/">← 文章列表</a>
        <span className={`status status-${label.kind}`} role="status">
          {label.text}
        </span>
        <span className="state">{STATE_LABEL[state]}</span>
        <button type="button" aria-expanded={showSnapshots} onClick={() => setShowSnapshots((v) => !v)}>
          快照
        </button>
        <button type="button" onClick={() => fileInput.current?.click()}>
          插入圖片
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          aria-label="選擇圖片"
          onChange={(e) => {
            void insertImages([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
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
      {uploading > 0 && <p className="hint">圖片上傳中…</p>}
      {uploadError && <p className="banner">圖片上傳失敗 {uploadError}</p>}
      {showSnapshots && <SnapshotPanel docId={draft.doc_id} onRestore={restore} />}
      <div className="split">
        <textarea
          ref={textarea}
          aria-label="Markdown"
          value={content.markdown}
          onChange={(e) => update({ ...content, markdown: e.target.value })}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              void insertImages(files);
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const files = [...e.dataTransfer.files];
            if (files.length > 0) {
              e.preventDefault();
              void insertImages(files);
            }
          }}
          spellCheck={false}
        />
        {/* Preview of the author's own Markdown, same renderer as the public site. */}
        <div className="preview" dangerouslySetInnerHTML={{ __html: preview }} />
      </div>
    </div>
  );
}
