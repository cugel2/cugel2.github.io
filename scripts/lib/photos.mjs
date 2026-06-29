import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parseFrontmatter } from "./content.mjs";

// Shared content + image model. The build's source of truth is two things:
//   - images/photos/*  (the canonical originals, gitignored)
//   - content/photos/<id>.md  (the canonical metadata, one file per photo)
// loadPhotos() joins them, validates, and returns enriched photo objects used
// by the manifest, the generated pages, and the sitemaps.

export const SITE_URL = "https://johnbraybrooke.com";

const cwd = process.cwd();
const photoDirectory = path.join(cwd, "images", "photos");
const contentDirectory = path.join(cwd, "content", "photos");
const largeDirectory = path.join(cwd, "images", "large");
const largeSmallDirectory = path.join(largeDirectory, "small");
const thumbDirectory = path.join(cwd, "images", "thumbs");
const thumbSmallDirectory = path.join(thumbDirectory, "small");

const sourceExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const REQUIRED_FIELDS = ["alt", "description", "date", "creator"];

export function contentPathFor(id) {
  return path.join(contentDirectory, `${id}.md`);
}

async function imageSet(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

  return new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
}

function webpNameFor(filename) {
  return `${path.basename(filename, path.extname(filename))}.webp`;
}

function variant(directory, images, filename, width) {
  if (!images.has(filename)) {
    return null;
  }

  const webpName = webpNameFor(filename);

  // Root-relative ("/images/…") so the paths resolve correctly no matter what
  // the current URL is — the overlay viewer changes the address to /photos/<id>/
  // via pushState, and relative paths would otherwise resolve against that.
  return {
    jpeg: `/${directory}/${filename}`,
    webp: images.has(webpName) ? `/${directory}/${webpName}` : "",
    width
  };
}

function srcset(variants, key) {
  return variants
    .filter(Boolean)
    .filter((entry) => entry[key])
    .map((entry) => `${entry[key]} ${entry.width}w`)
    .join(", ");
}

// Read an image's pixel dimensions via sips (already a project dependency).
export function imageDimensions(filePath) {
  const result = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath], {
    encoding: "utf8"
  });

  const width = Number((result.stdout.match(/pixelWidth:\s*(\d+)/) || [])[1]) || null;
  const height = Number((result.stdout.match(/pixelHeight:\s*(\d+)/) || [])[1]) || null;

  return { width, height };
}

// EXIF capture date as YYYY-MM-DD, or "" if unavailable.
export function exifDate(filePath) {
  const result = spawnSync("sips", ["-g", "creation", filePath], { encoding: "utf8" });
  const match = (result.stdout || "").match(/creation:\s*(\d{4}):(\d{2}):(\d{2})/);

  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

export async function sourceIds() {
  const entries = await readdir(photoDirectory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => sourceExtensions.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((name) => path.basename(name, path.extname(name)));
}

// Join images + metadata into enriched photo objects. Throws with a clear,
// aggregated message if any photo is missing a metadata file or a required field.
export async function loadPhotos() {
  const ids = await sourceIds();
  const largeImages = await imageSet(largeDirectory);
  const largeSmallImages = await imageSet(largeSmallDirectory);
  const thumbs = await imageSet(thumbDirectory);
  const thumbSmallImages = await imageSet(thumbSmallDirectory);

  const photos = [];
  const errors = [];

  for (const id of ids) {
    const webName = `${id}.jpg`;
    const webpName = `${id}.webp`;

    let frontmatter = null;

    try {
      const text = await readFile(contentPathFor(id), "utf8");
      frontmatter = parseFrontmatter(text).data;
    } catch {
      errors.push(`${id}: missing metadata file content/photos/${id}.md (run the build once to scaffold it)`);
      continue;
    }

    const missing = REQUIRED_FIELDS.filter((field) => !String(frontmatter[field] || "").trim());

    if (missing.length) {
      errors.push(`${id}: fill in ${missing.join(", ")} in content/photos/${id}.md`);
      continue;
    }

    const largeVariants = [
      variant("images/large/small", largeSmallImages, webName, 1600),
      variant("images/large", largeImages, webName, 3000)
    ];
    const thumbVariants = [
      variant("images/thumbs/small", thumbSmallImages, webName, 600),
      variant("images/thumbs", thumbs, webName, 900)
    ];

    const src = largeImages.has(webName) ? `/images/large/${webName}` : `/images/photos/${id}.jpg`;
    const dimensions = largeImages.has(webName)
      ? imageDimensions(path.join(largeDirectory, webName))
      : { width: null, height: null };

    const photo = {
      id,
      url: `${SITE_URL}/photos/${id}/`,
      title: (frontmatter.title || "").trim(),
      date: frontmatter.date,
      alt: frontmatter.alt,
      description: frontmatter.description,
      creator: frontmatter.creator,
      rights: frontmatter.rights || "All rights reserved",
      series: frontmatter.series || "",
      motifs: Array.isArray(frontmatter.motifs) ? frontmatter.motifs : [],
      width: dimensions.width,
      height: dimensions.height,
      src,
      imageUrl: `${SITE_URL}${src}`,
      srcSrcset: srcset(largeVariants, "jpeg"),
      srcWebpSrcset: srcset(largeVariants, "webp"),
      srcWebp: largeImages.has(webpName) ? `/images/large/${webpName}` : ""
    };

    if (thumbs.has(webName)) {
      photo.thumb = `/images/thumbs/${webName}`;
    }

    photo.thumbSrcset = srcset(thumbVariants, "jpeg");
    photo.thumbWebpSrcset = srcset(thumbVariants, "webp");

    if (thumbs.has(webpName)) {
      photo.thumbWebp = `/images/thumbs/${webpName}`;
    }

    photos.push(photo);
  }

  if (errors.length) {
    throw new Error(`Photo metadata is incomplete:\n  - ${errors.join("\n  - ")}`);
  }

  return photos;
}

// A short human label for a photo: its title, or a generic fallback when untitled.
export function displayTitle(photo) {
  return photo.title || "Photograph by John Braybrooke";
}
