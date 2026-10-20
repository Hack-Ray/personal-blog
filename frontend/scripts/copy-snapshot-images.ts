import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SITE_DATA_DIR } from "../src/content/load.ts";

const target = join(import.meta.dirname, "..", "public", "images");
const source = join(SITE_DATA_DIR, "images");

rmSync(target, { recursive: true, force: true });
if (existsSync(source)) cpSync(source, target, { recursive: true });
