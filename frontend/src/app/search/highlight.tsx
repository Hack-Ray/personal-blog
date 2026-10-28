import type { Segment } from "../../content/search.ts";

export function Highlight({ segments }: { segments: readonly Segment[] }) {
  return segments.map((s, i) => (s.mark ? <mark key={i}>{s.text}</mark> : s.text));
}
