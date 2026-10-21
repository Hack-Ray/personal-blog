import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { THUMBNAIL_WIDTH, thumbnailOf } from "../src/content/card.ts";
import { SITE_DATA_DIR } from "../src/content/load.ts";

const publicDir = join(import.meta.dirname, "..", "public");
const source = join(SITE_DATA_DIR, "images");

rmSync(join(publicDir, "images"), { recursive: true, force: true });
rmSync(join(publicDir, "thumbs"), { recursive: true, force: true });
if (existsSync(source)) {
  cpSync(source, join(publicDir, "images"), { recursive: true });
  mkdirSync(join(publicDir, "thumbs"));
  for (const name of readdirSync(source)) {
    const thumb = thumbnailOf(`images/${name}`);
    if (thumb.startsWith("thumbs/")) {
      // sharp reads only the first frame of an animated image.
      await sharp(join(source, name)).resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true }).webp().toFile(join(publicDir, thumb));
    }
  }
}
