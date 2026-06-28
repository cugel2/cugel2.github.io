import { readdir, unlink, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

// One command for the whole site. After you add or delete files in
// images/photos/, run `node scripts/build.mjs` and it will:
//   1. rename any new source files to photo-00001.jpg, photo-00002.jpg, ...
//   2. regenerate the grid thumbnails and the large viewer/zoom images
//   3. scaffold a metadata stub (content/photos/<id>.md) for any new photo,
//      prefilling its EXIF capture date; the build then fails until you fill in
//      the alt text and description
//   4. delete derivative images and generated pages left behind by removed photos
//   5. rebuild data/photos.json, the standalone photo pages, the homepage grid,
//      and the sitemaps/robots/llms files to match what is on disk
//
// images/photos/ + content/photos/ are the source of truth. Everything else
// (images/large, images/thumbs, photos/<id>/, data/photos.json, the sitemaps)
// is generated and safe to delete; this script recreates it.

const photoDirectory = path.join(process.cwd(), "images", "photos");
const sourceExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const derivativeExtensions = new Set([".jpg", ".webp"]);
const numberedPhoto = /^photo-\d{5}$/i;

// Directories holding generated images, paired with the prune pattern.
const derivativeDirectories = [
  path.join(process.cwd(), "images", "thumbs"),
  path.join(process.cwd(), "images", "thumbs", "small"),
  path.join(process.cwd(), "images", "large"),
  path.join(process.cwd(), "images", "large", "small")
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function basenamesInDirectory(directory, allowedExtensions) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => allowedExtensions.has(path.extname(name).toLowerCase()))
    .map((name) => path.basename(name, path.extname(name)));
}

async function pruneOrphans() {
  const liveBasenames = new Set(await basenamesInDirectory(photoDirectory, sourceExtensions));
  let removed = 0;

  for (const directory of derivativeDirectories) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      const basename = path.basename(entry.name, extension);

      // Only touch generated photo-NNNNN files, and only when no source remains.
      if (!derivativeExtensions.has(extension) || !numberedPhoto.test(basename)) {
        continue;
      }

      if (!liveBasenames.has(basename)) {
        await unlink(path.join(directory, entry.name));
        console.log(`removed orphan ${path.relative(process.cwd(), path.join(directory, entry.name))}`);
        removed += 1;
      }
    }
  }

  // Also remove generated photo-page directories for photos that no longer exist.
  const pagesRoot = path.join(process.cwd(), "photos");
  const pageEntries = await readdir(pagesRoot, { withFileTypes: true }).catch(() => []);

  for (const entry of pageEntries) {
    if (entry.isDirectory() && numberedPhoto.test(entry.name) && !liveBasenames.has(entry.name)) {
      await rm(path.join(pagesRoot, entry.name), { recursive: true, force: true });
      console.log(`removed orphan page photos/${entry.name}/`);
      removed += 1;
    }
  }

  console.log(`Pruned ${removed} orphaned item${removed === 1 ? "" : "s"}.`);
}

await run("node", ["scripts/rename-photos.mjs"]);
await run("node", ["scripts/build-photo-thumbnails.mjs"]);
await run("node", ["scripts/build-photo-large.mjs"]);
await run("node", ["scripts/scaffold-photos.mjs"]);
await pruneOrphans();
await run("node", ["scripts/build-photo-manifest.mjs"]);
await run("node", ["scripts/build-site.mjs"]);

console.log("Done.");
