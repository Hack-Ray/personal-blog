import { loadSearchAssets } from "../../../../content/load-search-assets.ts";
import { PLACEHOLDER, staticParams } from "../../../static-params.ts";

export const dynamic = "force-static";

export function generateStaticParams() {
  return staticParams("asset", [...loadSearchAssets().chunks.keys()]);
}

export async function GET(_request: Request, context: { params: Promise<{ asset: string }> }) {
  const { asset } = await context.params;
  const json = asset === PLACEHOLDER ? "{}" : loadSearchAssets().chunks.get(asset);
  return new Response(json, { status: json === undefined ? 404 : 200, headers: { "Content-Type": "application/json" } });
}
