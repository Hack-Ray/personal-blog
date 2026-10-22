import { useEffect, useMemo, useRef, useState } from "react";
import { SIGNED_IN, api, type Draft, type DraftContent } from "./api.ts";
import { DraftSync, type SyncStatus } from "./draft-sync.ts";
import { statusLabel, unsavedReason } from "./editor-status.ts";
import { STATE_LABEL } from "./labels.ts";
import { useLeaveGuard } from "./leave-guard.ts";
import { type Highlight, loadHighlighter, renderPreview } from "./preview.ts";
import { SnapshotPanel } from "./snapshot-panel.tsx";
import { imageIds } from "./cover.ts";
import { URL_POLICY, prePublishWarnings, urlProblems } from "./publish-checks.ts";
import { formatTags, isSlug, parseTags } from "./taxa.ts";

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={wide ? "field field-wide" : "field"}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Editor({ draft, onReload }: { draft: Draft; onReload: () => void }) {
  const [content, setContent] = useState<DraftContent>(draft);
  const [tagText, setTagText] = useState(formatTags(draft.tags));
  const [seriesText, setSeriesText] = useState(formatTags(draft.series ? [draft.series] : []));
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
    const current = new DraftSync(api, draft.doc_id, { revision: draft.revision, content: draft }, setStatus);
    sync.current = current;
    const retry = () => void current.flush();
    addEventListener(SIGNED_IN, retry);
    return () => {
      removeEventListener(SIGNED_IN, retry);
      void current.close();
    };
  }, [draft]);

  const { invalid } = parseTags(tagText);
  const seriesParsed = parseTags(seriesText);
  const seriesInvalid = seriesParsed.invalid.length > 0 || seriesParsed.tags.length > 1;
  const covers = useMemo(() => imageIds(content.markdown), [content.markdown]);
  const badUrls = useMemo(() => urlProblems(content.markdown), [content.markdown]);
  const topicValid = unsavedReason(content) === undefined;
  const label = statusLabel(status, content, sync.current?.current ?? draft);
  // Leaving the editor saves pending edits on the way out; edits that cannot
  // be saved (invalid Topic, conflict, failed save) would be lost.
  const stuck = label.kind === "unsaved" || label.kind === "conflict" || label.kind === "error";
  useLeaveGuard(label.kind !== "saved", stuck ? "這篇文章有無法儲存的修改，離開會遺失它們。確定要離開嗎？" : undefined);
  const [copied, setCopied] = useState("");
  const copyMarkdown = () =>
    navigator.clipboard.writeText(content.markdown).then(
      () => setCopied("已複製 Markdown。"),
      () => setCopied("無法複製，請手動選取 Markdown 複製。"),
    );
  const discardAndReload = () => {
    if (window.confirm("重新載入會捨棄這裡未儲存的修改，改用伺服器上的版本。確定嗎？")) onReload();
  };

  const update = (next: DraftContent) => {
    setContent(next);
    if (unsavedReason(next) === undefined) sync.current?.edit(next);
  };

  const publish = async () => {
    const warnings = prePublishWarnings(content);
    if (warnings.length > 0 && !window.confirm(`發布前請確認：\n\n${warnings.map((w) => `・${w}`).join("\n")}\n\n仍要發布嗎？`)) return;
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

  const [highlight, setHighlight] = useState<Highlight>();
  useEffect(() => {
    loadHighlighter().then((h) => setHighlight(() => h), () => {});
  }, []);
  const preview = useMemo(() => renderPreview(content.markdown, highlight), [content.markdown, highlight]);

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
        <button type="button" onClick={publish} disabled={status.kind === "conflict" || !topicValid || badUrls.length > 0}>
          發布
        </button>
      </div>
      {status.kind === "conflict" && (
        <p className="banner">
          伺服器上的草稿已是第 {status.currentRevision} 版（可能在其他分頁編輯過，或分類被改名、合併），這裡的修改不會再自動儲存。重新載入前，可以先複製這裡的 Markdown。
          <button type="button" onClick={() => void copyMarkdown()}>
            複製 Markdown
          </button>
          <button type="button" onClick={discardAndReload}>
            捨棄修改並重新載入
          </button>
          {copied && <span role="status"> {copied}</span>}
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
        <Field label="系列（slug:名稱，留空表示不屬於系列）">
          <input
            value={seriesText}
            aria-invalid={seriesInvalid}
            onChange={(e) => {
              setSeriesText(e.target.value);
              const { tags, invalid } = parseTags(e.target.value);
              update({ ...content, series: invalid.length === 0 && tags.length === 1 ? tags[0]! : null });
            }}
          />
        </Field>
        <Field label="封面圖" wide>
          <select value={content.cover ?? ""} onChange={(e) => update({ ...content, cover: e.target.value || null })}>
            <option value="">第一張圖片（預設）</option>
            {covers.map((id, i) => (
              <option key={id} value={id}>
                {`第 ${i + 1} 張圖片（${id.slice(0, 8)}…）`}
              </option>
            ))}
            {content.cover && !covers.includes(content.cover) && <option value={content.cover}>已不在文章中的圖片</option>}
          </select>
        </Field>
        <Field label="摘要（留空時使用文章開頭）">
          <textarea
            className="excerpt-input"
            value={content.excerpt}
            maxLength={300}
            rows={2}
            onChange={(e) => update({ ...content, excerpt: e.target.value })}
          />
        </Field>
      </div>
      {badUrls.length > 0 && (
        <p className="hint">
          修正後才能發布：{badUrls.join("、")}（{URL_POLICY}）
        </p>
      )}
      {invalid.length > 0 && <p className="hint">無效的 tag slug：{invalid.join("、")}</p>}
      {seriesInvalid && <p className="hint">系列只能填一個，slug 須為小寫英數與連字號。</p>}
      {content.cover && !covers.includes(content.cover) && <p className="hint">封面圖已不在文章中，發布前請重新選擇。</p>}
      {content.cover && covers.includes(content.cover) && (
        <img className="cover-preview" src={`/api/images/${content.cover}`} alt="封面圖預覽" />
      )}
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
        <div className="preview article-body" dangerouslySetInnerHTML={{ __html: preview }} />
      </div>
    </div>
  );
}
