import { loadSiteContent } from "../../content/load.ts";
import { buildIndex } from "../../content/search.ts";

export const dynamic = "force-static";

export function GET() {
  return Response.json(buildIndex(loadSiteContent()));
}
