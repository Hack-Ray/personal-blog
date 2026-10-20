import Link from "next/link";
import type { PublishedArticle } from "../content/model.ts";

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
      {articles.map((a) => (
        <li key={a.docId}>
          <Link href={`/posts/${a.docId}/`}>{a.title}</Link>
          <ArticleMeta article={a} />
        </li>
      ))}
    </ul>
  );
}
