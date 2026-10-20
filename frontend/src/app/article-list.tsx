import Link from "next/link";
import type { PublishedArticle } from "../content/model.ts";
import { firstImage, summary } from "../content/summary.ts";
import { BASE_PATH } from "../site.ts";

const dateFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeZone: "Asia/Taipei" });

export function ArticleMeta({ article }: { article: PublishedArticle }) {
  return (
    <p className="meta">
      <time dateTime={article.publishedAt.toISOString()}>{dateFormat.format(article.publishedAt)}</time>
      {" · "}
      <Link href={`/topics/${article.topic.slug}/`}>{article.topic.name}</Link>
      {article.tags.map((t) => (
        <span key={t.slug}>
          {" · "}
          <Link href={`/tags/${t.slug}/`}>#{t.name}</Link>
        </span>
      ))}
    </p>
  );
}

export function ArticleList({ articles }: { articles: PublishedArticle[] }) {
  return (
    <ul className="article-list">
      {articles.map((a) => {
        const image = firstImage(a.markdown);
        return (
          <li key={a.docId}>
            <div>
              <Link href={`/posts/${a.docId}/`}>{a.title}</Link>
              <ArticleMeta article={a} />
              <p className="excerpt">{summary(a.markdown)}</p>
            </div>
            {image && <img className="thumbnail" src={`${BASE_PATH}/${image}`} alt="" loading="lazy" />}
          </li>
        );
      })}
    </ul>
  );
}
