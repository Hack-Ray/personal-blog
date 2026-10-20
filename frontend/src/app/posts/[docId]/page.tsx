import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSiteContent } from "../../../content/load.ts";
import { renderMarkdown } from "../../../content/markdown.ts";
import { parseDocId } from "../../../content/parse.ts";
import { findArticle } from "../../../content/queries.ts";
import { ArticleMeta } from "../../article-list.tsx";

type Props = { params: Promise<{ docId: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return loadSiteContent().articles.map((a) => ({ docId: a.docId }));
}

async function article(params: Props["params"]) {
  const found = findArticle(loadSiteContent(), parseDocId((await params).docId));
  if (!found) notFound();
  return found;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = await article(params);
  return a.state === "archived" ? { title: "文章已封存", robots: { index: false } } : { title: a.title };
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
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(a.markdown, process.env.BASE_PATH ?? "") }} />
    </article>
  );
}
