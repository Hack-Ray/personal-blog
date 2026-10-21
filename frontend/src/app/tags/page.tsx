import type { Metadata } from "next";
import { loadSiteContent } from "../../content/load.ts";
import { taxonCounts } from "../../content/queries.ts";
import { absoluteUrl } from "../../site.ts";
import { TaxonIndex } from "../taxon-index.tsx";

export const metadata: Metadata = { title: "標籤", alternates: { canonical: absoluteUrl("/tags/") } };

export default function TagsPage() {
  return <TaxonIndex kind="tags" counts={taxonCounts(loadSiteContent(), (a) => a.tags)} />;
}
