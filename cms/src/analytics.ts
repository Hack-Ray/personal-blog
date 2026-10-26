import type { SourceStatus } from "./api.ts";

export const RANGES = [7, 28, 90] as const;
export type Range = (typeof RANGES)[number];

/** A sync is worth starting when a configured source has data older than the backend's limit. */
export function shouldAutoSync(sources: SourceStatus[]): boolean {
  return sources.some((s) => s.configured && s.stale);
}

const count = new Intl.NumberFormat("zh-TW");
const compact = new Intl.NumberFormat("zh-TW", { notation: "compact", maximumFractionDigits: 1 });

export const formatCount = (n: number) => count.format(n);
export const formatCompact = (n: number) => compact.format(n);

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}`;
}

export const formatPercent = (ratio: number | null) => (ratio === null ? "—" : `${(ratio * 100).toFixed(1)}%`);
export const formatPosition = (position: number | null) => (position === null ? "—" : position.toFixed(1));

/** "10/26" for an ISO day, read as the UTC day the backend means. */
export function formatDay(day: string): string {
  const [, month, date] = day.split("-");
  return `${Number(month)}/${Number(date)}`;
}

/** Every ISO day from start to end inclusive. */
export function daysBetween(start: string, end: string): string[] {
  const days = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/** One value per day in `days`; a day with no row is null, so the chart shows a gap instead of a false zero. */
export function seriesFor<T extends { day: string }>(days: string[], rows: T[], pick: (row: T) => number): (number | null)[] {
  const byDay = new Map(rows.map((r) => [r.day, pick(r)]));
  return days.map((d) => byDay.get(d) ?? null);
}

/** Round whole-number axis ticks from 0 to at least `max`, about four steps. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const multiples = magnitude >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  const step = Math.max(1, multiples.map((m) => m * magnitude).find((s) => s >= rough)!);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  return ticks;
}

/** An SVG path through the points, broken where a value is missing. */
export function linePath(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  const parts: string[] = [];
  let drawing = false;
  values.forEach((v, i) => {
    if (v === null) {
      drawing = false;
      return;
    }
    const point = `${round(x(i))} ${round(y(v))}`;
    const next = values[i + 1];
    // A lone day between gaps gets a zero-length segment, which the round cap draws as a dot.
    parts.push(drawing ? `L${point}` : next === null || next === undefined ? `M${point}h0` : `M${point}`);
    drawing = true;
  });
  return parts.join("");
}

const round = (n: number) => Math.round(n * 10) / 10;

/** The index of the day nearest to `px` on a plot `width` wide with `n` evenly spaced days. */
export function nearestIndex(px: number, width: number, n: number): number {
  if (n <= 1) return 0;
  return Math.min(n - 1, Math.max(0, Math.round((px / width) * (n - 1))));
}

/** A page URL as its path, which is what tells pages of one site apart. */
export function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return decodeURI(u.pathname) + u.search;
  } catch {
    return url;
  }
}
