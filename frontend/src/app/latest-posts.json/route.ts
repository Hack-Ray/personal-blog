import { loadSiteContent } from "../../content/load.ts";
import { published } from "../../content/queries.ts";

export const dynamic = "force-static";

/** The 404 page's list: a few titles, so it does not fetch the whole search index. */
export function GET() {
  return Response.json(published(loadSiteContent()).slice(0, 5).map((a) => ({ docId: a.docId, title: a.title })));
}
