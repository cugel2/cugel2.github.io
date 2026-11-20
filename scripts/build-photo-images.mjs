import { mkdir, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { SOURCE_EXTENSIONS } from "./lib/photos.mjs";

// Makes the web-sized copies of each original in images/photos/:
//   images/thumbs/        900px wide  (grid)
//   images/thumbs/small/  600px wide  (grid, small screens)
//   images/large/         3000px max  (viewer + zoom)
//   images/large/small/   1600px max  (viewer, small screens)
// plus a .webp beside each .jpg when cwebp is installed.
//
// A photo is only (re)made when one of its copies is missing or the original is
// newer than them. Re-encoding never gives byte-identical files, so redoing
// every photo on every build would make git see every image as changed, bloat
// the repository and make visitors re-download photos that didn't change.
// To force a photo to be remade, delete its copies (or touch the original).

const cwd = process.cwd();
const sourceDirectory = path.join(cwd, "images", "photos");

const variants = [
  { directory: "images/thumbs", resize: ["--resampleWidth", "900"], quality: 82, webpQuality: 82 },
  { directory: "images/thumbs/small", resize: ["--resampleWidth", "600"], quality: 82, webpQuality: 82 },
  { directory: "images/large", resize: ["--resampleHeightWidthMax", "3000"], quality: 86, webpQuality: 84 },
  { directory: "images/large/small", resize: ["--resampleHeightWidthMax", "1600"], quality: 84, webpQuality: 82 }
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });
}

const modifiedTime = (filePath) => stat(filePath).then((info) => info.mtimeMs, () => null);

// cwebp is optional. Homebrew installs it outside the default PATH of some
// shells, so look there too.
const cwebp = ["cwebp", "/opt/homebrew/bin/cwebp", "/usr/local/bin/cwebp"];
let cwebpCommand = null;

for (const candidate of cwebp) {
  if (await run(candidate, ["-version"]).then(() => true, () => false)) {
    cwebpCommand = candidate;
    break;
  }
}

const hasWebp = cwebpCommand !== null;

for (const variant of variants) {
  await mkdir(path.join(cwd, variant.directory), { recursive: true });
}

const sourceFiles = (await readdir(sourceDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => SOURCE_EXTENSIONS.has(path.extname(name).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

let made = 0;

for (const filename of sourceFiles) {
  const sourcePath = path.join(sourceDirectory, filename);
  const id = path.basename(filename, path.extname(filename));
  const sourceTime = await modifiedTime(sourcePath);

  const outputs = variants.map((variant) => ({
    ...variant,
    jpeg: path.join(cwd, variant.directory, `${id}.jpg`),
    webp: path.join(cwd, variant.directory, `${id}.webp`)
  }));
  const outputPaths = outputs.flatMap((output) => (hasWebp ? [output.jpeg, output.webp] : [output.jpeg]));
  const outputTimes = await Promise.all(outputPaths.map(modifiedTime));

  if (outputTimes.every((time) => time !== null && time >= sourceTime)) {
    continue;
  }

  for (const output of outputs) {
    await run("sips", [
      ...output.resize,
      "--setProperty", "format", "jpeg",
      "--setProperty", "formatOptions", String(output.quality),
      sourcePath,
      "--out", output.jpeg
    ]);

    if (hasWebp) {
      await run(cwebpCommand, ["-quiet", "-q", String(output.webpQuality), output.jpeg, "-o", output.webp]);
    }
  }

  console.log(`made web images for ${filename}`);
  made += 1;
}

const kept = sourceFiles.length - made;
console.log(`Made images for ${made} photo${made === 1 ? "" : "s"}; ${kept} already up to date.`);
