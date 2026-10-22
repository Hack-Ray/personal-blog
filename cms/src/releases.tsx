import { useCallback, useEffect, useState } from "react";
import { api, type Release, type ReleaseStatus } from "./api.ts";
import { tokenWarning } from "./token-warning.ts";

const LABEL: Record<ReleaseStatus, string> = {
  exported: "已匯出",
  push_failed: "push 失敗",
  pushed: "已 push",
  dispatch_failed: "無法啟動部署",
  dispatched: "等待建置",
  building: "建置中",
  deployed: "已上線",
  superseded: "已被較新的發布取代",
  failed: "建置或部署失敗",
};
// exported and pushed only last while 更新網站 runs; one left there was cut off.
const RETRYABLE: ReleaseStatus[] = ["exported", "push_failed", "pushed", "dispatch_failed", "failed"];
const PENDING: ReleaseStatus[] = ["dispatched", "building"];
const time = new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short" });

export function Releases() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [tokenNotice, setTokenNotice] = useState("");
  useEffect(() => {
    api.githubToken().then((t) => setTokenNotice(tokenWarning(t.expires_at, new Date())), () => {});
  }, []);
  const [message, setMessage] = useState<{ text: string; ok: boolean }>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.releases().then(setReleases, (e) => setMessage({ text: String(e), ok: false })), []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!releases.some((r) => PENDING.includes(r.status))) return;
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [releases, load]);

  const run = async (action: () => Promise<unknown>, done: (result: unknown) => string) => {
    setBusy(true);
    setMessage(undefined);
    try {
      setMessage({ text: done(await action()), ok: true });
      await load();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="toolbar">
        <a href="#/">← 文章列表</a>
        <h1>網站發布</h1>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(api.createRelease, (r) => ((r as { release: Release | null }).release ? "已匯出並開始部署。" : "已發布的內容沒有變更，不需要更新網站。"))
          }
        >
          更新網站
        </button>
      </div>
      {tokenNotice && <p className="banner">{tokenNotice}</p>}
      <p className="hint">把所有已發布、已封存的文章與「網站與關於」頁的內容匯出到內容 repo，並啟動 GitHub Pages 部署。</p>
      {message && <p className={message.ok ? "banner ok" : "banner"}>{message.text}</p>}
      <table>
        <thead>
          <tr>
            <th>時間</th>
            <th>狀態</th>
            <th>說明</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {releases.map((r, i) => (
            <tr key={r.id}>
              <td>{time.format(new Date(r.created_at))}</td>
              <td>{LABEL[r.status]}</td>
              <td>
                {r.detail}
                {r.run_url && (
                  <>
                    {" "}
                    <a href={r.run_url} target="_blank" rel="noreferrer">
                      GitHub Actions
                    </a>
                  </>
                )}
              </td>
              <td className="actions">
                {i === 0 && RETRYABLE.includes(r.status) && (
                  <button type="button" disabled={busy} onClick={() => run(() => api.retryRelease(r.id), () => "已重試。")}>
                    重試
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {releases.length === 0 && <p className="hint">還沒有發布紀錄。</p>}
    </>
  );
}
