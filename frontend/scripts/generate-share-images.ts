// Draws public/og/<docId>.png for every published article without a cover (see src/content/share-image.ts).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { loadSiteContent } from "../src/content/load.ts";
import { published } from "../src/content/queries.ts";
import {
  hasCjk,
  hasGeneratedShareImage,
  ICON_POSITION,
  ICON_SIZE,
  shareImageOf,
  shareImageSvg,
} from "../src/content/share-image.ts";
import { TIME_ZONE } from "../src/site.ts";

const CONCURRENCY = 4;
const publicDir = join(import.meta.dirname, "..", "public");
const outDir = join(publicDir, "og");
const dateFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "long", timeZone: TIME_ZONE });

// librsvg draws a missing glyph as a box and says nothing, so a build without a CJK font would deploy boxes.
function requireCjkFont() {
  let fonts: string;
  try {
    fonts = execFileSync("fc-list", [":lang=zh-tw"], { encoding: "utf8" });
  } catch {
    console.warn("fc-list is not available, so the CJK font in the share images is unchecked.");
    return;
  }
  if (!fonts.trim()) {
    throw new Error("A title has CJK characters but no CJK font is installed (fc-list :lang=zh-tw is empty). Install fonts-noto-cjk.");
  }
}

const content = loadSiteContent();
const { profile } = content;
const articles = published(content).filter(hasGeneratedShareImage);

rmSync(outDir, { recursive: true, force: true });
if (articles.length > 0) {
  mkdirSync(outDir, { recursive: true });
  if (articles.some((a) => hasCjk(a.title) || hasCjk(profile.site.title) || hasCjk(a.topic.name))) requireCjkFont();
  const icon = await sharp(readFileSync(join(publicDir, "icon.svg")), { density: 288 * (ICON_SIZE / 64) })
    .resize(ICON_SIZE, ICON_SIZE)
    .png()
    .toBuffer();
  const started = performance.now();
  const queue = [...articles];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        const svg = shareImageSvg({
          title: a.title,
          siteTitle: profile.site.title,
          topic: a.topic.name,
          date: dateFormat.format(a.publishedAt),
        });
        await sharp(Buffer.from(svg))
          .composite([{ input: icon, ...ICON_POSITION }])
          .png({ palette: true, effort: 1, compressionLevel: 6 })
          .toFile(join(publicDir, shareImageOf(a)));
      }
    }),
  );
  console.log(`Drew ${articles.length} share images in ${Math.round(performance.now() - started)} ms.`);
}
