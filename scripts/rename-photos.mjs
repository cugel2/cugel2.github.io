import { mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { SOURCE_EXTENSIONS } from "./lib/photos.mjs";

// Gives each new original its permanent number: 1.jpg, 2.jpg, 3.heic, ...
// New originals can be dropped into images/new/ (the intended place) or
// straight into images/photos/; either way they end up in images/photos/ under
// their new name. Already-numbered files are never touched.

const photoDirectory = path.join(process.cwd(), "images", "photos");
const inboxDirectory = path.join(process.cwd(), "images", "new");
const metadataDirectory = path.join(process.cwd(), "content", "photos");
const numberedPhoto = /^(\d+)\.[a-z0-9]+$/i;
const metadataPhoto = /^(\d+)\.md$/i;

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

async function imageFilesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => SOURCE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort(byName);
}

await mkdir(photoDirectory, { recursive: true });
await mkdir(inboxDirectory, { recursive: true });

const numberedFiles = await imageFilesIn(photoDirectory);
const metadataFiles = await readdir(metadataDirectory).catch(() => []);

// Removed photos keep their content/photos/<id>.md, so counting those too means
// a deleted photo's number (even the newest one) is never handed out again.
let nextNumber = Math.max(0, ...[
  ...numberedFiles.map((filename) => filename.match(numberedPhoto)?.[1]),
  ...metadataFiles.map((filename) => filename.match(metadataPhoto)?.[1])
].filter(Boolean).map(Number)) + 1;

const newFiles = [
  ...numberedFiles.filter((name) => !numberedPhoto.test(name)).map((name) => path.join(photoDirectory, name)),
  ...(await imageFilesIn(inboxDirectory)).map((name) => path.join(inboxDirectory, name))
];

for (const sourcePath of newFiles) {
  const extension = path.extname(sourcePath).toLowerCase().replace(".jpeg", ".jpg").replace(".tiff", ".tif");
  const newName = `${nextNumber}${extension}`;

  await rename(sourcePath, path.join(photoDirectory, newName));
  console.log(`${path.relative(process.cwd(), sourcePath)} -> images/photos/${newName}`);
  nextNumber += 1;
}

if (newFiles.length === 0) {
  console.log("No new photos to number.");
}
