import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { THUMBNAIL_WIDTH, thumbnailOf } from "../src/content/card.ts";
import { IMAGE_SIZES_FILE, SITE_DATA_DIR } from "../src/content/load.ts";

const publicDir = join(import.meta.dirname, "..", "public");
const source = join(SITE_DATA_DIR, "images");

rmSync(join(publicDir, "images"), { recursive: true, force: true });
rmSync(join(publicDir, "thumbs"), { recursive: true, force: true });
rmSync(IMAGE_SIZES_FILE, { force: true });
const sizes: Record<string, { width: number; height: number }> = {};
if (existsSync(source)) {
  cpSync(source, join(publicDir, "images"), { recursive: true });
  mkdirSync(join(publicDir, "thumbs"));
  for (const name of readdirSync(source)) {
    const { width, height } = await sharp(join(source, name)).metadata();
    sizes[`images/${name}`] = { width, height };
    const thumb = thumbnailOf(`images/${name}`);
    if (thumb.startsWith("thumbs/")) {
      // sharp reads only the first frame of an animated image.
      await sharp(join(source, name)).resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true }).webp().toFile(join(publicDir, thumb));
    }
  }
}
mkdirSync(dirname(IMAGE_SIZES_FILE), { recursive: true });
writeFileSync(IMAGE_SIZES_FILE, JSON.stringify(sizes));
