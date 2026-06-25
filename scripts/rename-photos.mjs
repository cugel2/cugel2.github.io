import { readdir, rename } from "node:fs/promises";
import path from "node:path";

const photoDirectory = path.join(process.cwd(), "images", "photos");
const imageExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const numberedPhoto = /^photo-(\d{5})\.[a-z0-9]+$/i;

const entries = await readdir(photoDirectory, { withFileTypes: true });
const imageFiles = entries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((filename) => imageExtensions.has(path.extname(filename).toLowerCase()));

let nextNumber = imageFiles.reduce((highest, filename) => {
  const match = filename.match(numberedPhoto);
  return match ? Math.max(highest, Number(match[1])) : highest;
}, 0) + 1;

const filesToRename = imageFiles
  .filter((filename) => !numberedPhoto.test(filename))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

for (const filename of filesToRename) {
  const extension = path.extname(filename).toLowerCase().replace(".jpeg", ".jpg");
  const newName = `photo-${String(nextNumber).padStart(5, "0")}${extension}`;

  await rename(path.join(photoDirectory, filename), path.join(photoDirectory, newName));
  console.log(`${filename} -> ${newName}`);
  nextNumber += 1;
}

if (filesToRename.length === 0) {
  console.log("No photos needed renaming.");
}
