import type { Metadata } from "next";
import { absoluteUrl } from "../../site.ts";
import { SearchBox } from "./search-box.tsx";

export const metadata: Metadata = { title: "搜尋", alternates: { canonical: absoluteUrl("/search/") } };

export default function SearchPage() {
  return (
    <>
      <h1>搜尋</h1>
      <SearchBox />
    </>
  );
}
