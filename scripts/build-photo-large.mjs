import { mkdir, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const sourceDirectory = path.join(process.cwd(), "images", "photos");
const outputDirectory = path.join(process.cwd(), "images", "large");
const smallOutputDirectory = path.join(outputDirectory, "small");
const imageExtensions = new Set([".jpeg", ".jpg", ".png", ".webp"]);
const maxDimension = 2400;
const smallMaxDimension = 1400;

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

async function canRun(command) {
  try {
    await run(command, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

async function writeJpeg(sourcePath, outputPath, maxSize, quality) {
  await run("sips", [
    "--resampleHeightWidthMax",
    String(maxSize),
    "--setProperty",
    "format",
    "jpeg",
    "--setProperty",
    "formatOptions",
    String(quality),
    sourcePath,
    "--out",
    outputPath
  ]);
}

async function writeWebp(sourcePath, outputPath, quality) {
  await run("cwebp", [
    "-quiet",
    "-q",
    String(quality),
    sourcePath,
    "-o",
    outputPath
  ]);
}

await mkdir(outputDirectory, { recursive: true });
await mkdir(smallOutputDirectory, { recursive: true });
const shouldWriteWebp = await canRun("cwebp");

const entries = await readdir(sourceDirectory, { withFileTypes: true });
const sourceFiles = entries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((filename) => imageExtensions.has(path.extname(filename).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

for (const filename of sourceFiles) {
  const sourcePath = path.join(sourceDirectory, filename);
  const basename = path.basename(filename, path.extname(filename));
  const outputName = `${basename}.jpg`;
  const webpName = `${basename}.webp`;
  const outputPath = path.join(outputDirectory, outputName);
  const smallOutputPath = path.join(smallOutputDirectory, outputName);

  await writeJpeg(sourcePath, outputPath, maxDimension, 86);
  await writeJpeg(sourcePath, smallOutputPath, smallMaxDimension, 84);

  if (shouldWriteWebp) {
    await writeWebp(outputPath, path.join(outputDirectory, webpName), 84);
    await writeWebp(smallOutputPath, path.join(smallOutputDirectory, webpName), 82);
  }

  console.log(`${filename} -> images/large/${outputName}`);
}

console.log(`Wrote ${sourceFiles.length} large image${sourceFiles.length === 1 ? "" : "s"}.`);
