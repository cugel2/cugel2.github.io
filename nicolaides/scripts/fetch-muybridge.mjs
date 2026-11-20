// Downloads Northwestern's "Muybridge in Motion" IIIF collection and every plate
// manifest into research/muybridge/ (ignored by git). Run once, or again to refresh:
//   node scripts/fetch-muybridge.mjs
// Then `node scripts/build-muybridge.mjs` turns them into src/data/muybridge.json.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const COLLECTION = "https://nulib-ds.github.io/muybridge/iiif/collection.json";
const OUT = resolve(import.meta.dirname, "../research/muybridge");
mkdirSync(OUT, { recursive: true });

async function get(url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return await response.text();
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((done) => setTimeout(done, 1000 * attempt));
    }
  }
}

const collection = await get(COLLECTION);
writeFileSync(join(OUT, "collection.json"), collection);
const items = JSON.parse(collection).items;
let next = 0;
let fetched = 0;
async function worker() {
  while (next < items.length) {
    const item = items[next++];
    const file = join(OUT, item.id.split("/").pop());
    if (existsSync(file)) continue;
    writeFileSync(file, await get(item.id));
    fetched += 1;
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`${items.length} plates in the collection, ${fetched} manifests fetched`);
