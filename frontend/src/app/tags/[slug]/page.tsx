import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSiteContent } from "../../../content/load.ts";
import { tags, withTag } from "../../../content/queries.ts";
import { ArticleList } from "../../article-list.tsx";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return tags(loadSiteContent()).map((t) => ({ slug: t.slug }));
}

async function tag(params: Props["params"]) {
  const slug = (await params).slug;
  return tags(loadSiteContent()).find((t) => t.slug === slug) ?? notFound();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `#${(await tag(params)).name}` };
}

export default async function TagPage({ params }: Props) {
  const t = await tag(params);
  return (
    <>
      <h1>#{t.name}</h1>
      <ArticleList articles={withTag(loadSiteContent(), t.slug)} />
    </>
  );
}
