import { plainText } from "./summary.ts";

const CJK = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/gu;
const CJK_PER_MINUTE = 400;
const WORDS_PER_MINUTE = 200;

/** Minutes to read an article: CJK characters at 400/min, other words at 200/min, at least 1. */
export function readingMinutes(markdown: string): number {
  const text = plainText(markdown);
  const cjk = text.match(CJK)?.length ?? 0;
  const words = text.replace(CJK, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.ceil(cjk / CJK_PER_MINUTE + words / WORDS_PER_MINUTE));
}
