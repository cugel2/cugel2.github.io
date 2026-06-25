import { mkdir, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const sourceDirectory = path.join(process.cwd(), "images", "photos");
const outputDirectory = path.join(process.cwd(), "images", "thumbs");
const imageExtensions = new Set([".jpeg", ".jpg", ".png", ".webp"]);
const thumbnailWidth = 900;

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

await mkdir(outputDirectory, { recursive: true });

const entries = await readdir(sourceDirectory, { withFileTypes: true });
const sourceFiles = entries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((filename) => imageExtensions.has(path.extname(filename).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

for (const filename of sourceFiles) {
  const sourcePath = path.join(sourceDirectory, filename);
  const outputName = `${path.basename(filename, path.extname(filename))}.jpg`;
  const outputPath = path.join(outputDirectory, outputName);

  await run("sips", [
    "--resampleWidth",
    String(thumbnailWidth),
    "--setProperty",
    "format",
    "jpeg",
    "--setProperty",
    "formatOptions",
    "82",
    sourcePath,
    "--out",
    outputPath
  ]);

  console.log(`${filename} -> images/thumbs/${outputName}`);
}

console.log(`Wrote ${sourceFiles.length} thumbnail${sourceFiles.length === 1 ? "" : "s"}.`);
