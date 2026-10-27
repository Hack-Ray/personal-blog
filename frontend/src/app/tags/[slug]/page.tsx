import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { taxonDescription } from "../../../content/card.ts";
import { loadSiteContent } from "../../../content/load.ts";
import { tags, withTag } from "../../../content/queries.ts";
import { ArticleList } from "../../article-list.tsx";
import { absoluteUrl } from "../../../site.ts";
import { staticParams } from "../../static-params.ts";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return staticParams(
    "slug",
    tags(loadSiteContent()).map((t) => t.slug),
  );
}

async function tag(params: Props["params"]) {
  const slug = (await params).slug;
  return tags(loadSiteContent()).find((t) => t.slug === slug) ?? notFound();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await tag(params);
  return {
    title: `#${t.name}`,
    description: taxonDescription(`#${t.name} 標籤`, withTag(loadSiteContent(), t.slug)),
    alternates: { canonical: absoluteUrl(`/tags/${t.slug}/`) },
  };
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
