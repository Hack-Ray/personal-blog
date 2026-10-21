import { Marked } from "marked";
import type { DraftContent } from "./api.ts";
import { imageIds } from "./cover.ts";

const marked = new Marked();
// Share previews and search results cut titles around this length.
const TITLE_LIMIT = 60;

/** Things worth a second look before publishing; none of them blocks it. */
export function prePublishWarnings(content: DraftContent): string[] {
  let noAlt = 0;
  let insecure = 0;
  marked.walkTokens(marked.lexer(content.markdown), (token) => {
    if (token.type === "image" && token.text.trim() === "") noAlt++;
    if ((token.type === "link" || token.type === "image") && token.href.startsWith("http://")) insecure++;
  });
  const warnings: string[] = [];
  if (content.tags.length === 0) warnings.push("沒有任何 Tag");
  if (noAlt > 0) warnings.push(`${noAlt} 張圖片沒有替代文字（![這裡](…)），圖片也就沒有圖說`);
  if ([...content.title.trim()].length > TITLE_LIMIT) warnings.push(`標題超過 ${TITLE_LIMIT} 字，分享預覽可能被截斷`);
  if (insecure > 0) warnings.push(`${insecure} 個連結或圖片使用不安全的 http://`);
  if (/\bTODO\b/.test(content.markdown)) warnings.push("內文還有 TODO");
  if (content.cover && !imageIds(content.markdown).includes(content.cover)) warnings.push("封面圖已不在文章中，發布會失敗");
  return warnings;
}
