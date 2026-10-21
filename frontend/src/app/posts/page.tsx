import type { Metadata } from "next";
import { absoluteUrl } from "../../site.ts";
import { PostIndex } from "./post-index.tsx";

export const metadata: Metadata = { title: "文章", alternates: { canonical: absoluteUrl("/posts/") } };

export default function PostsPage() {
  return <PostIndex n={1} />;
}
