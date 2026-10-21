import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { tocHeadings } from "../../../content/headings.ts";
import { loadSiteContent } from "../../../content/load.ts";
import { renderMarkdown } from "../../../content/markdown.ts";
import type { DocId } from "../../../content/model.ts";
import { findArticle, inSeries, neighbors, related } from "../../../content/queries.ts";
import { readingMinutes } from "../../../content/reading.ts";
import { coverOf, excerptOf } from "../../../content/card.ts";
import { ArticleMeta } from "../../article-list.tsx";
import { absoluteUrl, BASE_PATH, siteOg } from "../../../site.ts";
import { staticParams } from "../../static-params.ts";
import { ArticleBody } from "../../article-body.tsx";
import { ArticleToc } from "./article-toc.tsx";
import { Comments } from "./comments.tsx";
import { ReadingProgress } from "./reading-progress.tsx";

type Props = { params: Promise<{ docId: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return staticParams(
    "docId",
    loadSiteContent().articles.map((a) => a.docId),
  );
}

async function article(params: Props["params"]) {
  const found = findArticle(loadSiteContent(), (await params).docId as DocId);
  if (!found) notFound();
  return found;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = await article(params);
  if (a.state === "archived") return { title: "文章已封存", robots: { index: false } };
  const url = absoluteUrl(`/posts/${a.docId}/`);
  const image = coverOf(a);
  const images = image ? [absoluteUrl(`/${image}`)] : undefined;
  return {
    title: a.title,
    description: excerptOf(a),
    alternates: { canonical: url },
    openGraph: {
      ...siteOg(loadSiteContent().profile.site.title),
      type: "article",
      url,
      title: a.title,
      description: excerptOf(a),
      publishedTime: a.publishedAt.toISOString(),
      modifiedTime: a.updatedAt?.toISOString(),
      tags: a.tags.map((t) => t.name),
      images,
    },
    twitter: { card: images ? "summary_large_image" : "summary", title: a.title, description: excerptOf(a), images },
  };
}

export default async function PostPage({ params }: Props) {
  const a = await article(params);
  if (a.state === "archived") {
    return (
      <>
        <h1>文章已封存</h1>
        <p>此文章已下架，內容目前不公開。</p>
      </>
    );
  }
  const toc = tocHeadings(a.markdown);
  const { newer, older } = neighbors(loadSiteContent(), a.docId);
  const relatedArticles = related(loadSiteContent(), a.docId);
  const series = a.series && inSeries(loadSiteContent(), a.series.slug);
  return (
    <article>
      <ReadingProgress />
      <h1>{a.title}</h1>
      <ArticleMeta article={a} readingMinutes={readingMinutes(a.markdown)} showUpdated />
      {a.series && series && (
        <nav className="series" aria-label={`系列：${a.series.name}`}>
          <p className="series-title">
            系列：{a.series.name}
            <span className="meta">
              {` 第 ${series.findIndex((s) => s.docId === a.docId) + 1} 篇，共 ${series.length} 篇`}
            </span>
          </p>
          <ol>
            {series.map((s) => (
              <li key={s.docId}>
                {s.docId === a.docId ? (
                  <span aria-current="page">{s.title}</span>
                ) : (
                  <Link href={`/posts/${s.docId}/`}>{s.title}</Link>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      {toc.length > 0 && <ArticleToc headings={toc} />}
      <ArticleBody html={renderMarkdown(a.markdown, BASE_PATH)} />
      {relatedArticles.length > 0 && (
        <section className="related" aria-labelledby="related-title">
          <h2 id="related-title">相關文章</h2>
          <ul>
            {relatedArticles.map((r) => (
              <li key={r.docId}>
                <Link href={`/posts/${r.docId}/`}>{r.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(newer || older) && (
        <nav className="post-nav" aria-label="上下篇文章">
          {older && (
            <Link href={`/posts/${older.docId}/`} rel="prev">
              <span className="meta">← 較舊</span>
              {older.title}
            </Link>
          )}
          {newer && (
            <Link href={`/posts/${newer.docId}/`} rel="next" className="next">
              <span className="meta">較新 →</span>
              {newer.title}
            </Link>
          )}
        </nav>
      )}
      <Comments docId={a.docId} />
    </article>
  );
}
