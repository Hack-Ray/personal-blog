import type { Metadata } from "next";
import { absoluteUrl } from "../../site.ts";
import { SearchResults } from "./search-results.tsx";

export const metadata: Metadata = { title: "搜尋", alternates: { canonical: absoluteUrl("/search/") } };

export default function SearchPage() {
  return (
    <>
      <h1>搜尋</h1>
      <SearchResults />
    </>
  );
}
