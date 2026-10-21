import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSiteContent } from "../../../../content/load.ts";
import { page } from "../../../../content/queries.ts";
import { absoluteUrl } from "../../../../site.ts";
import { staticParams } from "../../../static-params.ts";
import { PostIndex, pageHref } from "../../post-index.tsx";

type Props = { params: Promise<{ n: string }> };

export const dynamicParams = false;

// Page 1 is /posts/, so this route starts at 2.
export function generateStaticParams() {
  const { pages } = page(loadSiteContent(), 1);
  return staticParams(
    "n",
    Array.from({ length: pages - 1 }, (_, i) => String(i + 2)),
  );
}

async function pageNumber(params: Props["params"]): Promise<number> {
  const n = Number((await params).n);
  return Number.isInteger(n) && n >= 2 && n <= page(loadSiteContent(), 1).pages ? n : notFound();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = await pageNumber(params);
  return { title: `文章（第 ${n} 頁）`, alternates: { canonical: absoluteUrl(pageHref(n)) } };
}

export default async function PostsPage({ params }: Props) {
  return <PostIndex n={await pageNumber(params)} />;
}
