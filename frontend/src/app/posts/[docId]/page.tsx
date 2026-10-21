import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadSiteContent } from "../../../content/load.ts";
import { renderMarkdown } from "../../../content/markdown.ts";
import type { DocId } from "../../../content/model.ts";
import { findArticle, neighbors } from "../../../content/queries.ts";
import { summary } from "../../../content/summary.ts";
import { ArticleMeta } from "../../article-list.tsx";
import { absoluteUrl, BASE_PATH } from "../../../site.ts";
import { staticParams } from "../../static-params.ts";
import { Comments } from "./comments.tsx";

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
  return {
    title: a.title,
    description: summary(a.markdown),
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      title: a.title,
      description: summary(a.markdown),
      publishedTime: a.publishedAt.toISOString(),
      tags: a.tags.map((t) => t.name),
    },
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
  const { newer, older } = neighbors(loadSiteContent(), a.docId);
  return (
    <article>
      <h1>{a.title}</h1>
      <ArticleMeta article={a} />
      {/* Markdown comes only from the site author through the CMS. */}
      <div className="article-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.markdown, BASE_PATH) }} />
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
