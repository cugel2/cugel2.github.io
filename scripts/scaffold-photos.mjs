import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { sourceIds, contentPathFor, exifDate } from "./lib/photos.mjs";

// Create a metadata stub for any photo that doesn't have one yet, prefilling the
// capture date from EXIF. Required fields (alt, description) are left blank on
// purpose: the build fails until they're filled, so a new photo can't quietly
// publish without a description. Existing metadata files are never touched.

const photoDirectory = path.join(process.cwd(), "images", "photos");

function stub(id, date) {
  return `---
id: ${id}
title: ""
date: "${date}"
alt: ""
description: ""
creator: "John Braybrooke"
rights: "All rights reserved"
series: ""
motifs: []
notes: []
---
`;
}

await mkdir(path.join(process.cwd(), "content", "photos"), { recursive: true });

const ids = await sourceIds();
let created = 0;

for (const id of ids) {
  const target = contentPathFor(id);
  const exists = await access(target).then(() => true).catch(() => false);

  if (exists) {
    continue;
  }

  const date = exifDate(path.join(photoDirectory, `${id}.jpg`));
  await writeFile(target, stub(id, date));
  console.log(`scaffolded content/photos/${id}.md${date ? ` (date ${date})` : " (no EXIF date — fill in manually)"}`);
  created += 1;
}

console.log(`Scaffolded ${created} metadata stub${created === 1 ? "" : "s"}.`);
