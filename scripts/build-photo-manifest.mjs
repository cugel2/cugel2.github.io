import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const photoDirectory = path.join(process.cwd(), "images", "photos");
const largeDirectory = path.join(process.cwd(), "images", "large");
const thumbDirectory = path.join(process.cwd(), "images", "thumbs");
const manifestPath = path.join(process.cwd(), "data", "photos.json");
const imageExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const numberedPhoto = /^photo-\d{5}$/i;

function titleFromFilename(filename) {
  const name = path.basename(filename, path.extname(filename));

  if (numberedPhoto.test(name)) {
    return "";
  }

  return name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const entries = await readdir(photoDirectory, { withFileTypes: true });
const largeEntries = await readdir(largeDirectory, { withFileTypes: true }).catch(() => []);
const largeImages = new Set(
  largeEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
);

const thumbEntries = await readdir(thumbDirectory, { withFileTypes: true }).catch(() => []);
const thumbs = new Set(
  thumbEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
);

const photos = entries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((filename) => imageExtensions.has(path.extname(filename).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
  .map((filename) => {
    const webName = `${path.basename(filename, path.extname(filename))}.jpg`;
    const photo = {
      src: largeImages.has(webName) ? `images/large/${webName}` : `images/photos/${filename}`,
      alt: titleFromFilename(filename)
    };

    if (thumbs.has(webName)) {
      photo.thumb = `images/thumbs/${webName}`;
    }

    return photo;
  });

await writeFile(manifestPath, `${JSON.stringify(photos, null, 2)}\n`);

console.log(`Wrote ${photos.length} photo${photos.length === 1 ? "" : "s"} to data/photos.json`);
