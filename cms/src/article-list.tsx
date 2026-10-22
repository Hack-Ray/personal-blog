import { useCallback, useEffect, useState } from "react";
import { api, type ArticleState, type ArticleSummary } from "./api.ts";
import { STATE_LABEL } from "./labels.ts";

type Filter = "live" | "pending_deletion";

const date = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" });

const ACTIONS: Record<ArticleState, { label: string; run: (docId: string) => Promise<unknown>; confirm?: string }[]> = {
  draft: [{ label: "刪除", run: api.remove }],
  published: [
    { label: "封存", run: api.archive },
    { label: "刪除", run: api.remove },
  ],
  archived: [{ label: "刪除", run: api.remove }],
  pending_deletion: [
    { label: "復原", run: api.restore },
    { label: "永久刪除", run: api.purge, confirm: "永久刪除後無法復原，確定嗎？" },
  ],
};

export function ArticleList() {
  const [filter, setFilter] = useState<Filter>("live");
  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const all = await api.list(filter === "pending_deletion" ? "pending_deletion" : undefined);
    setItems(filter === "live" ? all.filter((a) => a.state !== "pending_deletion") : all);
  }, [filter]);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  const act = async (run: (docId: string) => Promise<unknown>, docId: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setError("");
    try {
      await run(docId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="toolbar">
        <h1>文章</h1>
        <a className="button" href="#/new">
          新增文章
        </a>
        <a className="button" href="#/taxa">
          分類管理
        </a>
        <a className="button" href="#/profile">
          網站與關於
        </a>
        <a className="button" href="#/releases">
          網站發布
        </a>
        <button
          type="button"
          onClick={() => api.signOut().then(() => location.reload(), (e) => setError(`登出失敗：${e instanceof Error ? e.message : String(e)}`))}
        >
          登出
        </button>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm("登出所有裝置與瀏覽器（包括這一個）？")) return;
            api.signOutEverywhere().then(() => location.reload(), (e) => setError(`登出失敗：${e instanceof Error ? e.message : String(e)}`));
          }}
        >
          登出所有裝置
        </button>
      </div>
      <div role="tablist" className="tabs">
        <button type="button" role="tab" aria-selected={filter === "live"} onClick={() => setFilter("live")}>
          所有文章
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "pending_deletion"}
          onClick={() => setFilter("pending_deletion")}
        >
          待刪除區
        </button>
      </div>
      {error && <p className="banner">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>標題</th>
            <th>狀態</th>
            {filter === "pending_deletion" && <th>永久刪除日</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.doc_id}>
              <td>
                {a.pinned && a.state !== "pending_deletion" && <span className="pin">置頂</span>}
                {a.state === "pending_deletion" ? a.title || "（無標題）" : <a href={`#/edit/${a.doc_id}`}>{a.title || "（無標題）"}</a>}
              </td>
              <td>{STATE_LABEL[a.state]}</td>
              {filter === "pending_deletion" && <td>{a.purge_after && date.format(new Date(a.purge_after))}</td>}
              <td className="actions">
                {a.state === "published" && (
                  <button type="button" onClick={() => act((id) => api.setPinned(id, !a.pinned), a.doc_id)}>
                    {a.pinned ? "取消置頂" : "置頂"}
                  </button>
                )}
                {ACTIONS[a.state].map(({ label, run, confirm }) => (
                  <button key={label} type="button" onClick={() => act(run, a.doc_id, confirm)}>
                    {label}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <p className="hint">沒有文章。</p>}
    </>
  );
}
