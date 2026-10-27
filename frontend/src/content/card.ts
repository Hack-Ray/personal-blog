import type { PublishedArticle } from "./model.ts";
import { imagePaths } from "./parse.ts";
import { summary } from "./summary.ts";

/** The excerpt for lists, meta descriptions and the feed. */
export const excerptOf = (a: PublishedArticle): string => a.excerpt ?? summary(a.markdown);

/** The images/ path for list thumbnails and share previews, if the article has an image. */
export const coverOf = (a: PublishedArticle): string | undefined => a.cover ?? imagePaths(a.markdown)[0];

export const THUMBNAIL_WIDTH = 320;

/**
 * The build writes a THUMBNAIL_WIDTH-wide WebP of every raster image to
 * thumbs/ (scripts/copy-snapshot-images.ts); SVGs scale, so they are used as is.
 */
export const thumbnailOf = (image: string): string =>
  image.endsWith(".svg") ? image : `thumbs/${image.slice("images/".length).replace(/\.[^.]+$/, "")}.webp`;

const DESCRIPTION_TITLES = 3;

/** The meta description of a topic or tag page, such as "Backend 主題的 3 篇文章：〈A〉、〈B〉、〈C〉。"; `articles` is newest first. */
export const taxonDescription = (label: string, articles: PublishedArticle[]): string =>
  `${label}的 ${articles.length} 篇文章：${articles
    .slice(0, DESCRIPTION_TITLES)
    .map((a) => `〈${a.title}〉`)
    .join("、")}。`;
