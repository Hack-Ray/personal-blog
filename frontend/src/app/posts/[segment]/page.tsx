import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { tocHeadings } from "../../../content/headings.ts";
import { loadSiteContent } from "../../../content/load.ts";
import { renderMarkdown } from "../../../content/markdown.ts";
import { findArticle, inSeries, neighbors, postPath, postSegments, related } from "../../../content/queries.ts";
import { jsonLd, blogPosting, breadcrumbList } from "../../../content/structured-data.ts";
import { readingMinutes } from "../../../content/reading.ts";
import { excerptOf } from "../../../content/card.ts";
import { hasGeneratedShareImage, SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH, shareImageOf } from "../../../content/share-image.ts";
import { ArticleMeta } from "../../article-list.tsx";
import { absoluteUrl, BASE_PATH, siteOg } from "../../../site.ts";
import { staticParams } from "../../static-params.ts";
import { ArticleBody } from "../../article-body.tsx";
import { ArticleToc } from "./article-toc.tsx";
import { Comments } from "./comments.tsx";
import { ReadingProgress } from "./reading-progress.tsx";
import { Share } from "./share.tsx";

type Props = { params: Promise<{ segment: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return staticParams("segment", postSegments(loadSiteContent()));
}

async function find(params: Props["params"]) {
  const found = findArticle(loadSiteContent(), (await params).segment);
  if (!found) notFound();
  return found;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { article: a, redirect } = await find(params);
  const title = a.state === "archived" ? "文章已封存" : a.title;
  if (redirect) return { title, robots: { index: false }, alternates: { canonical: absoluteUrl(postPath(a)) } };
  if (a.state === "archived") return { title, robots: { index: false } };
  const url = absoluteUrl(postPath(a));
  // Every article has an og:image, so share previews such as iOS's share sheet always have a picture.
  const image = absoluteUrl(`/${shareImageOf(a)}`);
  const drawn = hasGeneratedShareImage(a);
  const images = drawn ? [{ url: image, width: SHARE_IMAGE_WIDTH, height: SHARE_IMAGE_HEIGHT, alt: a.title }] : [image];
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
    twitter: { card: "summary_large_image", title: a.title, description: excerptOf(a), images: [image] },
  };
}

export default async function PostPage({ params }: Props) {
  const { article: a, redirect } = await find(params);
  // GitHub Pages cannot send a redirect status, so an earlier URL is a page that refreshes to the current one.
  if (redirect) {
    return (
      <>
        <meta httpEquiv="refresh" content={`0; url=${BASE_PATH}${postPath(a)}`} />
        <h1>文章已搬到新網址</h1>
        <p>
          <Link href={postPath(a)}>前往文章</Link>
        </p>
      </>
    );
  }
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(blogPosting(a, loadSiteContent().profile)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList(a, loadSiteContent().profile.site.title)) }}
      />
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
                  <Link href={postPath(s)}>{s.title}</Link>
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
                <Link href={postPath(r)}>{r.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(newer || older) && (
        <nav className="post-nav" aria-label="上下篇文章">
          {older && (
            <Link href={postPath(older)} rel="prev">
              <span className="meta">← 較舊</span>
              {older.title}
            </Link>
          )}
          {newer && (
            <Link href={postPath(newer)} rel="next" className="next">
              <span className="meta">較新 →</span>
              {newer.title}
            </Link>
          )}
        </nav>
      )}
      <Share url={absoluteUrl(postPath(a))} title={a.title} />
      <Comments docId={a.docId} />
    </article>
  );
}
