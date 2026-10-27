"use client";

import Link from "next/link";
import { useState } from "react";

export type ArchiveEntry = { key: string; title: string; href: string; dateTime: string; day: string };
export type ArchiveYears = { year: number; months: { month: number; entries: ArchiveEntry[] }[] }[];

const reversed = (years: ArchiveYears): ArchiveYears =>
  years.toReversed().map(({ year, months }) => ({ year, months: months.toReversed().map(({ month, entries }) => ({ month, entries: entries.toReversed() })) }));

// Receives the list once, newest first, as plain data; the other order is derived here.
export function SortableList({ years }: { years: ArchiveYears }) {
  const [newestFirst, setNewestFirst] = useState(true);
  const shown = newestFirst ? years : reversed(years);
  return (
    <>
      <button type="button" onClick={() => setNewestFirst((v) => !v)}>
        {newestFirst ? "由新到舊" : "由舊到新"}
      </button>
      {shown.map(({ year, months }) => (
        <section key={year} className="archive-year">
          <h2>{`${year} 年`}</h2>
          {months.map(({ month, entries }) => (
            <div key={month}>
              <h3>{`${month} 月`}</h3>
              <ul className="archive-list">
                {entries.map((e) => (
                  <li key={e.key}>
                    <time className="meta" dateTime={e.dateTime}>
                      {e.day}
                    </time>
                    <Link href={e.href}>{e.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
