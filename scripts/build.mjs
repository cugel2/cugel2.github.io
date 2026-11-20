import { readdir, unlink, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { SOURCE_EXTENSIONS } from "./lib/photos.mjs";

// One command for the whole site: `node scripts/build.mjs`. It will:
//   1. number any new originals (dropped into images/new/ or images/photos/)
//      as 1.jpg, 2.jpg, ... in images/photos/
//   2. make the grid thumbnails and large viewer/zoom images for new or changed
//      photos only (unchanged photos are left alone, so git sees no churn)
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
const sourceExtensions = SOURCE_EXTENSIONS;
const derivativeExtensions = new Set([".jpg", ".webp"]);
const numberedPhoto = /^\d+$/;

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

      // Only touch generated numbered files, and only when no source remains.
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

try {
  await run("node", ["scripts/rename-photos.mjs"]);
  await run("node", ["scripts/build-photo-images.mjs"]);
  await run("node", ["scripts/scaffold-photos.mjs"]);
  await pruneOrphans();
  await run("node", ["scripts/build-photo-manifest.mjs"]);
  await run("node", ["scripts/build-site.mjs"]);
} catch {
  // The step that failed has already printed why.
  console.error("Build stopped before the pages were rebuilt.");
  process.exit(1);
}

console.log("Done.");
