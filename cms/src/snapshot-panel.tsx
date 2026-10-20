import { useEffect, useState } from "react";
import { api, type Snapshot } from "./api.ts";

const time = new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short" });

export function SnapshotPanel({ docId, onRestore }: { docId: string; onRestore: (id: number) => void }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>();
  const [selected, setSelected] = useState<Snapshot>();

  useEffect(() => {
    api.snapshots(docId).then(setSnapshots, () => setSnapshots([]));
  }, [docId]);

  if (!snapshots) return <aside className="snapshots">載入中…</aside>;
  return (
    <aside className="snapshots" aria-label="草稿快照">
      <h2>草稿快照</h2>
      {snapshots.length === 0 && <p className="hint">這段編輯期間還沒有快照。發布後快照會清除。</p>}
      <ul>
        {snapshots.map((s) => (
          <li key={s.id}>
            <button type="button" aria-pressed={selected?.id === s.id} onClick={() => setSelected(s)}>
              {time.format(new Date(s.created_at))} · {s.markdown.length} 字
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <>
          <pre className="snapshot-text">{selected.markdown}</pre>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("用這個快照取代目前的 Markdown？目前內容會先存成快照。")) onRestore(selected.id);
            }}
          >
            還原這個快照
          </button>
        </>
      )}
    </aside>
  );
}
