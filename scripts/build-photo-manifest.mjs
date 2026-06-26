import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const photoDirectory = path.join(process.cwd(), "images", "photos");
const largeDirectory = path.join(process.cwd(), "images", "large");
const largeSmallDirectory = path.join(largeDirectory, "small");
const thumbDirectory = path.join(process.cwd(), "images", "thumbs");
const thumbSmallDirectory = path.join(thumbDirectory, "small");
const zoomDirectory = path.join(process.cwd(), "images", "zoom");
const zoomSmallDirectory = path.join(zoomDirectory, "small");
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

async function imageSet(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

  return new Set(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
  );
}

function webpNameFor(filename) {
  return `${path.basename(filename, path.extname(filename))}.webp`;
}

function hasWebp(images, filename) {
  return images.has(webpNameFor(filename));
}

function formatSrcset(variants, key) {
  return variants
    .filter((variant) => variant[key])
    .map((variant) => `${variant[key]} ${variant.width}w`)
    .join(", ");
}

function addResponsiveFields(photo, key, variants) {
  const jpegSrcset = formatSrcset(variants, "jpeg");
  const webpSrcset = formatSrcset(variants, "webp");

  if (jpegSrcset) {
    photo[`${key}Srcset`] = jpegSrcset;
  }

  if (webpSrcset) {
    photo[`${key}WebpSrcset`] = webpSrcset;
  }
}

function variant(directory, images, filename, width) {
  if (!images.has(filename)) {
    return null;
  }

  const webpName = webpNameFor(filename);

  return {
    jpeg: `${directory}/${filename}`,
    webp: images.has(webpName) ? `${directory}/${webpName}` : "",
    width
  };
}

function variantsFor(definitions) {
  return definitions.filter(Boolean);
}

const entries = await readdir(photoDirectory, { withFileTypes: true });
const largeImages = await imageSet(largeDirectory);
const largeSmallImages = await imageSet(largeSmallDirectory);
const thumbs = await imageSet(thumbDirectory);
const thumbSmallImages = await imageSet(thumbSmallDirectory);
const zoomImages = await imageSet(zoomDirectory);
const zoomSmallImages = await imageSet(zoomSmallDirectory);

const photos = entries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((filename) => imageExtensions.has(path.extname(filename).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
  .map((filename) => {
    const webName = `${path.basename(filename, path.extname(filename))}.jpg`;
    const webpName = webpNameFor(webName);
    const largeVariants = variantsFor([
      variant("images/large/small", largeSmallImages, webName, 1400),
      variant("images/large", largeImages, webName, 2400)
    ]);
    const thumbVariants = variantsFor([
      variant("images/thumbs/small", thumbSmallImages, webName, 600),
      variant("images/thumbs", thumbs, webName, 900)
    ]);
    const zoomVariants = variantsFor([
      variant("images/zoom/small", zoomSmallImages, webName, 3000),
      variant("images/zoom", zoomImages, webName, 5000)
    ]);
    const photo = {
      src: largeImages.has(webName) ? `images/large/${webName}` : `images/photos/${filename}`,
      alt: titleFromFilename(filename)
    };

    addResponsiveFields(photo, "src", largeVariants);

    if (hasWebp(largeImages, webName)) {
      photo.srcWebp = `images/large/${webpName}`;
    }

    if (thumbs.has(webName)) {
      photo.thumb = `images/thumbs/${webName}`;
    }

    addResponsiveFields(photo, "thumb", thumbVariants);

    if (hasWebp(thumbs, webName)) {
      photo.thumbWebp = `images/thumbs/${webpName}`;
    }

    if (zoomImages.has(webName)) {
      photo.zoom = `images/zoom/${webName}`;
    }

    addResponsiveFields(photo, "zoom", zoomVariants);

    if (hasWebp(zoomImages, webName)) {
      photo.zoomWebp = `images/zoom/${webpName}`;
    }

    return photo;
  });

await writeFile(manifestPath, `${JSON.stringify(photos, null, 2)}\n`);

console.log(`Wrote ${photos.length} photo${photos.length === 1 ? "" : "s"} to data/photos.json`);
