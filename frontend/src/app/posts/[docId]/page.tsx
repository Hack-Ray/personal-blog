import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSiteContent } from "../../../content/load.ts";
import { renderMarkdown } from "../../../content/markdown.ts";
import type { DocId } from "../../../content/model.ts";
import { findArticle } from "../../../content/queries.ts";
import { summary } from "../../../content/summary.ts";
import { ArticleMeta } from "../../article-list.tsx";
import { absoluteUrl, BASE_PATH } from "../../../site.ts";
import { staticParams } from "../../static-params.ts";

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
  return (
    <article>
      <h1>{a.title}</h1>
      <ArticleMeta article={a} />
      {/* Markdown comes only from the site author through the CMS. */}
      <div className="article-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.markdown, BASE_PATH) }} />
    </article>
  );
}
