import type { Metadata } from "next";
import Link from "next/link";
import { loadSiteContent } from "../../content/load.ts";
import { type Archive, archive, postPath, published } from "../../content/queries.ts";
import { absoluteUrl, TIME_ZONE } from "../../site.ts";
import { SortableList } from "./sortable-list.tsx";

export const metadata: Metadata = { title: "歸檔", alternates: { canonical: absoluteUrl("/archive/") } };

const dayFormat = new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", timeZone: TIME_ZONE });

function Years({ years }: { years: Archive }) {
  return years.map(({ year, months }) => (
    <section key={year} className="archive-year">
      <h2>{`${year} 年`}</h2>
      {months.map(({ month, articles }) => (
        <div key={month}>
          <h3>{`${month} 月`}</h3>
          <ul className="archive-list">
            {articles.map((a) => (
              <li key={a.docId}>
                <time className="meta" dateTime={a.publishedAt.toISOString()}>
                  {dayFormat.format(a.publishedAt)}
                </time>
                <Link href={postPath(a)}>{a.title}</Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  ));
}

export default function ArchivePage() {
  const articles = published(loadSiteContent());
  return (
    <>
      <h1>歸檔</h1>
      {articles.length === 0 ? (
        <p>還沒有任何文章。</p>
      ) : (
        <SortableList
          newest={<Years years={archive(articles, TIME_ZONE)} />}
          oldest={<Years years={archive(articles.toReversed(), TIME_ZONE)} />}
        />
      )}
    </>
  );
}
