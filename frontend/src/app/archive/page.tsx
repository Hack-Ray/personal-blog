import type { Metadata } from "next";
import { loadSiteContent } from "../../content/load.ts";
import type { PublishedArticle } from "../../content/model.ts";
import { archive, postPath, published } from "../../content/queries.ts";
import { absoluteUrl, TIME_ZONE } from "../../site.ts";
import { type ArchiveYears, SortableList } from "./sortable-list.tsx";

export const metadata: Metadata = { title: "歸檔", alternates: { canonical: absoluteUrl("/archive/") } };

const dayFormat = new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", timeZone: TIME_ZONE });

function years(articles: PublishedArticle[]): ArchiveYears {
  return archive(articles, TIME_ZONE).map(({ year, months }) => ({
    year,
    months: months.map(({ month, articles }) => ({
      month,
      entries: articles.map((a) => ({
        key: a.docId,
        title: a.title,
        href: postPath(a),
        dateTime: a.publishedAt.toISOString(),
        day: dayFormat.format(a.publishedAt),
      })),
    })),
  }));
}

export default function ArchivePage() {
  const articles = published(loadSiteContent());
  return (
    <>
      <h1>歸檔</h1>
      {articles.length === 0 ? (
        <p>還沒有任何文章。</p>
      ) : (
        <SortableList years={years(articles)} />
      )}
    </>
  );
}
