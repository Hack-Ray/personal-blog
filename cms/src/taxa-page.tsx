import { useCallback, useEffect, useState } from "react";
import { api, type TaxonKind, type TaxonUsage } from "./api.ts";

const KINDS: { kind: TaxonKind; label: string }[] = [
  { kind: "topics", label: "Topic" },
  { kind: "tags", label: "Tag" },
  { kind: "series", label: "系列" },
];

function Row({ kind, taxon, others, run }: { kind: TaxonKind; taxon: TaxonUsage; others: TaxonUsage[]; run: (action: () => Promise<unknown>) => void }) {
  const [name, setName] = useState(taxon.name);
  const [into, setInto] = useState("");
  const renamed = name.trim() !== "" && name.trim() !== taxon.name;
  return (
    <tr>
      <td>
        <input aria-label={`${taxon.slug} 的名稱`} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" disabled={!renamed} onClick={() => run(() => api.renameTaxon(kind, taxon.slug, name.trim()))}>
          改名
        </button>
      </td>
      <td data-label="slug">
        <code>{taxon.slug}</code>
      </td>
      <td data-label="篇數">{taxon.articles}</td>
      <td className="actions">
        {others.length > 0 && (
          <>
            <select aria-label={`把 ${taxon.slug} 合併到`} value={into} onChange={(e) => setInto(e.target.value)}>
              <option value="">合併到…</option>
              {others.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.name}（{o.slug}）
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!into}
              onClick={() =>
                window.confirm(`把「${taxon.name}」合併到「${others.find((o) => o.slug === into)?.name}」？已發布的文章也會改用後者，原本的網址 /${kind}/${taxon.slug}/ 會失效。`) &&
                run(() => api.mergeTaxon(kind, taxon.slug, into))
              }
            >
              合併
            </button>
          </>
        )}
        {!taxon.in_use && (
          <button type="button" onClick={() => run(() => api.deleteTaxon(kind, taxon.slug))}>
            刪除
          </button>
        )}
      </td>
    </tr>
  );
}

export function TaxaPage() {
  const [taxa, setTaxa] = useState<Record<TaxonKind, TaxonUsage[]>>();
  const [error, setError] = useState("");
  const load = useCallback(() => api.taxa().then(setTaxa, (e) => setError(String(e))), []);
  useEffect(() => void load(), [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await load();
  };

  return (
    <div className="taxa-page">
      <div className="toolbar">
        <a href="#/">← 文章列表</a>
        <h1>分類管理</h1>
      </div>
      <p className="hint">
        改名與合併立即套用到草稿與已發布的文章，到「網站發布 → 更新網站」後才會出現在網站上。篇數只算目前的草稿；沒有任何草稿或已發布版本使用時才能刪除。編輯中的文章若仍填著被合併的 slug，下次自動儲存會重新建立它。
      </p>
      {error && <p className="banner">{error}</p>}
      {!taxa && !error && <p>載入中…</p>}
      {taxa &&
        KINDS.map(({ kind, label }) => (
          <section key={kind}>
            <h2>{label}</h2>
            {taxa[kind].length === 0 ? (
              <p className="hint">沒有{label}。</p>
            ) : (
              <table className="card-table">
                <thead>
                  <tr>
                    <th>名稱</th>
                    <th>slug</th>
                    <th>篇數</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {taxa[kind].map((t) => (
                    <Row
                      key={`${t.slug}:${t.name}`}
                      kind={kind}
                      taxon={t}
                      others={taxa[kind].filter((o) => o.slug !== t.slug)}
                      run={run}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}
    </div>
  );
}
