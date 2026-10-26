// Usage: node scripts/make-icons.ts
// Writes favicon.ico and apple-touch-icon.png from public/icon.svg. Edit the SVG, rerun, commit all three.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const publicDir = join(import.meta.dirname, "..", "public");
const svg = readFileSync(join(publicDir, "icon.svg"));
// Rasterized at 4x the target size, then scaled down, so small sizes stay sharp.
const render = (size: number) => sharp(svg, { density: 288 * (size / 64) }).resize(size, size);
const png = (size: number) => render(size).png().toBuffer();

// An ICO is a 6-byte header, a 16-byte entry per image, then the images; each image may be a whole PNG.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
writeFileSync(join(publicDir, "favicon.ico"), Buffer.concat([header, ...images]));

// iOS rounds the corners itself and shows transparent ones as black, so the touch icon fills its
// corners with the colour at the middle of the top edge, the icon's background.
const { data } = await render(180).raw().toBuffer({ resolveWithObject: true });
const top = 90 * 4;
await render(180)
  .flatten({ background: { r: data[top], g: data[top + 1], b: data[top + 2] } })
  .png()
  .toFile(join(publicDir, "apple-touch-icon.png"));
