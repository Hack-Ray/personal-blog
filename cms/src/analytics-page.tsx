import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type AnalyticsReport, type AnalyticsSourceName, type SearchItem, type SourceStatus } from "./api.ts";
import {
  RANGES,
  type Range,
  daysBetween,
  formatBytes,
  formatCompact,
  formatCount,
  formatDay,
  formatPercent,
  formatPosition,
  linePath,
  nearestIndex,
  niceTicks,
  pagePath,
  seriesFor,
  shouldAutoSync,
} from "./analytics.ts";

const time = new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short" });

const SOURCES: Record<AnalyticsSourceName, { title: string; keys: string[] }> = {
  cloudflare: { title: "Cloudflare 流量", keys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID"] },
  search_console: { title: "Google 搜尋", keys: ["GSC_SITE_URL", "GSC_CREDENTIALS_FILE"] },
};

export function AnalyticsPage() {
  const [range, setRange] = useState<Range>(28);
  const [report, setReport] = useState<AnalyticsReport>();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const rangeRef = useRef(range);
  const latest = useRef(0);

  // Only the newest request is shown, so a slow answer for an earlier range cannot replace it.
  const load = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    try {
      const r = await api.analytics(rangeRef.current);
      if (request !== latest.current) return undefined;
      setReport(r);
      setError("");
      return r;
    } catch (e) {
      if (request === latest.current) setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, []);

  const sync = useCallback(
    async (force: boolean) => {
      setSyncing(true);
      try {
        await api.syncAnalytics(force);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      await load();
      setSyncing(false);
    },
    [load],
  );

  // Opening the page refreshes stale data once; switching ranges only reads what is stored.
  useEffect(() => {
    let cancelled = false;
    void load().then((r) => {
      if (!cancelled && r && shouldAutoSync(r.sources)) void sync(false);
    });
    return () => void (cancelled = true);
  }, [load, sync]);

  const choose = (r: Range) => {
    setRange(r);
    rangeRef.current = r;
    void load();
  };

  const status = (name: AnalyticsSourceName) => report?.sources.find((s) => s.source === name);
  const anyConfigured = report?.sources.some((s) => s.configured) ?? false;

  return (
    <div className="analytics">
      <div className="toolbar">
        <a href="#/">← 文章列表</a>
        <h1>流量數據</h1>
        {anyConfigured && (
          <button type="button" disabled={syncing} onClick={() => void sync(true)}>
            立即更新
          </button>
        )}
      </div>
      {anyConfigured && (
        <div className="analytics-controls">
          <div role="tablist" className="tabs" aria-label="期間">
            {RANGES.map((r) => (
              <button key={r} type="button" role="tab" aria-selected={range === r} onClick={() => choose(r)}>
                {r} 天
              </button>
            ))}
          </div>
          <span className="hint" role="status">
            {syncing ? "更新中…" : report && `${report.start} – ${report.end}（UTC）`}
          </span>
        </div>
      )}
      {error && <p className="banner">{error}</p>}
      {!report && !error && <p>載入中…</p>}
      {report && (
        <div className={loading || syncing ? "analytics-body refreshing" : "analytics-body"}>
          {report.sources.map((s) => s.configured && s.error && <SyncError key={s.source} status={s} />)}
          <TrafficSection report={report} status={status("cloudflare")!} />
          <SearchSection report={report} status={status("search_console")!} />
        </div>
      )}
    </div>
  );
}

function SyncError({ status }: { status: SourceStatus }) {
  return (
    <p className="banner">
      {SOURCES[status.source].title}更新失敗：{status.error}
      <br />
      <span className="hint">
        {status.synced_at ? `下面是 ${time.format(new Date(status.synced_at))} 更新的資料。` : "還沒有成功更新過。"}
        處理方式見 docs/analytics.md 的「疑難排解」。
      </span>
    </p>
  );
}

function SetupCard({ source }: { source: AnalyticsSourceName }) {
  const { title, keys } = SOURCES[source];
  return (
    <div className="setup-card">
      <p>
        尚未設定。在 <code>backend/.env</code> 設定 {keys.map((k, i) => <span key={k}>{i > 0 && " 與 "}<code>{k}</code></span>)}
        ，重新啟動 CMS 後就會顯示 {title}。
      </p>
      <p className="hint">
        步驟見 repo 的 <code>docs/analytics.md</code>。沒有設定時 CMS 不會連線到{source === "cloudflare" ? " Cloudflare" : " Google"}。
      </p>
    </div>
  );
}

function SectionHeader({ title, status }: { title: string; status: SourceStatus }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {status.configured && status.synced_at && <span className="hint">更新於 {time.format(new Date(status.synced_at))}</span>}
    </div>
  );
}

function TrafficSection({ report, status }: { report: AnalyticsReport; status: SourceStatus }) {
  const title = SOURCES.cloudflare.title;
  if (!status.configured)
    return (
      <section className="analytics-section">
        <SectionHeader title={title} status={status} />
        <SetupCard source="cloudflare" />
      </section>
    );
  const t = report.traffic_totals;
  const days = daysBetween(report.start, report.end);
  return (
    <section className="analytics-section">
      <SectionHeader title={title} status={status} />
      <div className="tiles">
        <Tile label="請求數" value={formatCount(t.requests)} />
        <Tile label="頁面瀏覽" value={formatCount(t.page_views)} />
        <Tile label="不重複訪客" value={formatCount(t.visitors)} />
        <Tile label="流量" value={formatBytes(t.bytes)} />
        <Tile label="快取命中率" value={formatPercent(t.cache_hit_ratio)} />
      </div>
      {report.traffic.length === 0 ? (
        <p className="hint">這段期間還沒有資料。</p>
      ) : (
        <ChartCard title="每日頁面瀏覽與不重複訪客">
          <LineChart
            days={days}
            series={[
              { name: "頁面瀏覽", color: "var(--series-1)", values: seriesFor(days, report.traffic, (d) => d.page_views) },
              { name: "不重複訪客", color: "var(--series-2)", values: seriesFor(days, report.traffic, (d) => d.visitors) },
            ]}
          />
        </ChartCard>
      )}
      <p className="hint note">
        Cloudflare 的「不重複訪客」是每天依 IP 位址計算的近似值，同一人換網路會多算、多人共用 IP 會少算；期間總數是每日數字相加。頁面瀏覽也包含部分機器人。
      </p>
      {report.traffic.length > 0 && (
        <DataTable
          summary="每日數字"
          head={["日期", "請求數", "頁面瀏覽", "不重複訪客", "流量"]}
          rows={report.traffic.map((d) => [d.day, formatCount(d.requests), formatCount(d.page_views), formatCount(d.visitors), formatBytes(d.bytes)])}
        />
      )}
    </section>
  );
}

function SearchSection({ report, status }: { report: AnalyticsReport; status: SourceStatus }) {
  const title = SOURCES.search_console.title;
  if (!status.configured)
    return (
      <section className="analytics-section">
        <SectionHeader title={title} status={status} />
        <SetupCard source="search_console" />
      </section>
    );
  const t = report.search_totals;
  const days = daysBetween(report.start, report.end);
  return (
    <section className="analytics-section">
      <SectionHeader title={title} status={status} />
      <div className="tiles">
        <Tile label="點擊" value={formatCount(t.clicks)} />
        <Tile label="曝光" value={formatCount(t.impressions)} />
        <Tile label="點閱率" value={formatPercent(t.ctr)} />
        <Tile label="平均排名" value={formatPosition(t.position)} />
      </div>
      {report.search.length === 0 ? (
        <p className="hint">這段期間還沒有資料。</p>
      ) : (
        <div className="chart-pair">
          <ChartCard title="每日點擊">
            <LineChart days={days} series={[{ name: "點擊", color: "var(--series-1)", values: seriesFor(days, report.search, (d) => d.clicks) }]} />
          </ChartCard>
          <ChartCard title="每日曝光">
            <LineChart days={days} series={[{ name: "曝光", color: "var(--series-2)", values: seriesFor(days, report.search, (d) => d.impressions) }]} />
          </ChartCard>
        </div>
      )}
      <p className="hint note">Google 的資料約晚 2–3 天才出現，所以最近幾天是空的。平均排名以曝光數加權。</p>
      <div className="top-lists">
        <TopTable title="熱門搜尋字詞" keyLabel="字詞" items={report.top_queries} render={(k) => k} />
        <TopTable
          title="熱門頁面"
          keyLabel="頁面"
          items={report.top_pages}
          render={(k) => (
            <a href={k} target="_blank" rel="noreferrer">
              {pagePath(k)}
            </a>
          )}
        />
      </div>
      {report.search.length > 0 && (
        <DataTable
          summary="每日數字"
          head={["日期", "點擊", "曝光", "點閱率", "平均排名"]}
          rows={report.search.map((d) => [d.day, formatCount(d.clicks), formatCount(d.impressions), formatPercent(d.ctr), formatPosition(d.position)])}
        />
      )}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <figure className="chart-card">
      <figcaption>{title}</figcaption>
      {children}
    </figure>
  );
}

function TopTable({ title, keyLabel, items, render }: { title: string; keyLabel: string; items: SearchItem[]; render: (key: string) => React.ReactNode }) {
  return (
    <div className="top-table">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="hint">這段期間沒有資料。</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{keyLabel}</th>
                <th className="num">點擊</th>
                <th className="num">曝光</th>
                <th className="num">點閱率</th>
                <th className="num">排名</th>
              </tr>
            </thead>
            <tbody>
              {items.map((q) => (
                <tr key={q.key}>
                  <td className="key">{render(q.key)}</td>
                  <td className="num">{formatCount(q.clicks)}</td>
                  <td className="num">{formatCount(q.impressions)}</td>
                  <td className="num">{formatPercent(q.ctr)}</td>
                  <td className="num">{formatPosition(q.position)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DataTable({ summary, head, rows }: { summary: string; head: string[]; rows: string[][] }) {
  return (
    <details className="data-table">
      <summary>{summary}</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={h} className={i > 0 ? "num" : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]}>
                {r.map((cell, i) => (
                  <td key={i} className={i > 0 ? "num" : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

interface Series {
  name: string;
  color: string;
  values: (number | null)[];
}

const PLOT_HEIGHT = 160;
const MARGIN = { top: 8, right: 8, bottom: 24, left: 44 };

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function LineChart({ days, series }: { days: string[]; series: Series[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const max = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const x = (i: number) => MARGIN.left + (days.length <= 1 ? plotWidth / 2 : (i / (days.length - 1)) * plotWidth);
  const y = (v: number) => MARGIN.top + PLOT_HEIGHT - (v / top) * PLOT_HEIGHT;
  const labelDays = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, a) => a.indexOf(v) === i);

  const pick = (clientX: number, target: Element) => {
    const box = target.getBoundingClientRect();
    setActive(nearestIndex(clientX - box.left - MARGIN.left, plotWidth, days.length));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    setActive((a) => Math.min(days.length - 1, Math.max(0, (a ?? days.length - 1) + step)));
  };

  return (
    <div className="line-chart" ref={ref}>
      {series.length > 1 && (
        <ul className="legend">
          {series.map((s) => (
            <li key={s.name}>
              <span className="line-key" style={{ background: s.color }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      {width > 0 && (
        <div className="plot">
          <svg
            width={width}
            height={MARGIN.top + PLOT_HEIGHT + MARGIN.bottom}
            role="img"
            aria-label={`${series.map((s) => s.name).join("與")}，${days[0]} 到 ${days[days.length - 1]}；用左右鍵逐日查看`}
            tabIndex={0}
            onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive((a) => a ?? days.length - 1)}
            onBlur={() => setActive(null)}
            onKeyDown={onKey}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line className={t === 0 ? "axis" : "grid"} x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(t)} y2={y(t)} />
                <text className="tick" x={MARGIN.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                  {formatCompact(t)}
                </text>
              </g>
            ))}
            {labelDays.map((i, n) => (
              <text
                key={i}
                className="tick"
                x={x(i)}
                y={MARGIN.top + PLOT_HEIGHT + 16}
                textAnchor={labelDays.length > 1 && n === 0 ? "start" : n === labelDays.length - 1 && labelDays.length > 1 ? "end" : "middle"}
              >
                {formatDay(days[i]!)}
              </text>
            ))}
            {active !== null && <line className="crosshair" x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + PLOT_HEIGHT} />}
            {series.map((s) => (
              <path key={s.name} d={linePath(s.values, x, y)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {active !== null &&
              series.map((s) => {
                const v = s.values[active];
                return v === null || v === undefined ? null : <circle key={s.name} className="marker" cx={x(active)} cy={y(v)} r={4} fill={s.color} />;
              })}
          </svg>
          {active !== null && (
            <div
              className="chart-tooltip"
              style={x(active) > width / 2 ? { right: width - x(active) + 12 } : { left: x(active) + 12 }}
              aria-hidden="true"
            >
              <div className="tooltip-day">{days[active]}</div>
              {series.map((s) => (
                <div key={s.name} className="tooltip-row">
                  <span className="line-key" style={{ background: s.color }} />
                  <strong>{s.values[active] === null ? "無資料" : formatCount(s.values[active]!)}</strong>
                  <span>{s.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
