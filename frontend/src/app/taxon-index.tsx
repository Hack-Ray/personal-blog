import Link from "next/link";
import type { Taxon } from "../content/model.ts";

const KINDS = { topics: "主題", tags: "標籤" } as const;

/** The /topics/ and /tags/ pages: every topic or tag with its article count. */
export function TaxonIndex({ kind, counts }: { kind: keyof typeof KINDS; counts: { taxon: Taxon; count: number }[] }) {
  return (
    <>
      <nav className="taxon-tabs" aria-label="分類">
        {Object.entries(KINDS).map(([k, label]) => (
          <Link key={k} href={`/${k}/`} aria-current={k === kind ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      <h1>{KINDS[kind]}</h1>
      {counts.length === 0 ? (
        <p>{`還沒有任何${KINDS[kind]}。`}</p>
      ) : (
        <ul className="taxon-index">
          {counts.map(({ taxon, count }) => (
            <li key={taxon.slug}>
              <Link href={`/${kind}/${taxon.slug}/`}>
                {kind === "tags" ? `#${taxon.name}` : taxon.name}
                <span className="meta">{count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
