import Link from "next/link";
import type { PublishedArticle } from "../content/model.ts";
import { coverOf, excerptOf, thumbnailOf } from "../content/card.ts";
import { BASE_PATH, TIME_ZONE } from "../site.ts";

const dateFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeZone: TIME_ZONE });

/** The article page passes readingMinutes and showUpdated; lists keep the line short. */
export function ArticleMeta({
  article,
  readingMinutes,
  showUpdated = false,
}: {
  article: PublishedArticle;
  readingMinutes?: number;
  showUpdated?: boolean;
}) {
  return (
    <p className="meta">
      <time dateTime={article.publishedAt.toISOString()}>{dateFormat.format(article.publishedAt)}</time>
      {showUpdated && article.updatedAt && (
        <>
          {" · 更新於 "}
          <time dateTime={article.updatedAt.toISOString()}>{dateFormat.format(article.updatedAt)}</time>
        </>
      )}
      {" · "}
      <Link href={`/topics/${article.topic.slug}/`}>{article.topic.name}</Link>
      {article.tags.map((t) => (
        <span key={t.slug}>
          {" · "}
          <Link href={`/tags/${t.slug}/`}>#{t.name}</Link>
        </span>
      ))}
      {readingMinutes !== undefined && ` · 約 ${readingMinutes} 分鐘`}
    </p>
  );
}

export function ArticleList({ articles, showPinned = false }: { articles: PublishedArticle[]; showPinned?: boolean }) {
  return (
    <ul className="article-list">
      {articles.map((a) => {
        const image = coverOf(a);
        return (
          <li key={a.docId} className="article-card">
            <div>
              {showPinned && a.pinnedAt && <span className="pin-badge">置頂</span>}
              <Link href={`/posts/${a.docId}/`} className="post-link">
                {a.title}
              </Link>
              <ArticleMeta article={a} />
              <p className="excerpt">{excerptOf(a)}</p>
            </div>
            {image && <img className="thumbnail" src={`${BASE_PATH}/${thumbnailOf(image)}`} alt="" loading="lazy" />}
          </li>
        );
      })}
    </ul>
  );
}
