import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadPhotos } from "./lib/photos.mjs";

// Public catalogue: data/photos.json. Generated from the canonical metadata +
// images. Each entry carries both relative paths (used by the gallery frontend)
// and absolute canonical page + image URLs (used by crawlers and AI agents).

const manifestPath = path.join(process.cwd(), "data", "photos.json");
const photos = await loadPhotos();

await writeFile(manifestPath, `${JSON.stringify(photos, null, 2)}\n`);

console.log(`Wrote ${photos.length} photo${photos.length === 1 ? "" : "s"} to data/photos.json`);
