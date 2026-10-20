import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSiteContent } from "../../../content/load.ts";
import { inTopic, topics } from "../../../content/queries.ts";
import { ArticleList } from "../../article-list.tsx";
import { staticParams } from "../../static-params.ts";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return staticParams(
    "slug",
    topics(loadSiteContent()).map((t) => t.slug),
  );
}

async function topic(params: Props["params"]) {
  const slug = (await params).slug;
  return topics(loadSiteContent()).find((t) => t.slug === slug) ?? notFound();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await topic(params)).name };
}

export default async function TopicPage({ params }: Props) {
  const t = await topic(params);
  return (
    <>
      <h1>{t.name}</h1>
      <ArticleList articles={inTopic(loadSiteContent(), t.slug)} />
    </>
  );
}
