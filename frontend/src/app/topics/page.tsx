import type { Metadata } from "next";
import { loadSiteContent } from "../../content/load.ts";
import { taxonCounts } from "../../content/queries.ts";
import { absoluteUrl } from "../../site.ts";
import { TaxonIndex } from "../taxon-index.tsx";

export const metadata: Metadata = { title: "主題", alternates: { canonical: absoluteUrl("/topics/") } };

export default function TopicsPage() {
  return <TaxonIndex kind="topics" counts={taxonCounts(loadSiteContent(), (a) => [a.topic])} />;
}
