import { loadSearchAssets } from "../../content/load-search-assets.ts";

export const dynamic = "force-static";

export function GET() {
  return new Response(loadSearchAssets().metadataJson, { headers: { "Content-Type": "application/json" } });
}
