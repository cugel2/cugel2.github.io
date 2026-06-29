import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { loadPhotos, displayTitle, SITE_URL } from "./lib/photos.mjs";
import { loadNotes, displayNoteTitle } from "./lib/notes.mjs";

// Generate the crawlable, no-JS layer of the site from the catalogue:
//   - /photos/<id>/index.html   standalone page per photograph
//   - /notes/<slug>/index.html  standalone page per note
//   - index.html                real <a><img> grid + gallery JSON-LD (injected)
//   - sitemap.xml, image-sitemap.xml, robots.txt, llms.txt
// The JS overlay viewer is layered on top of this and is never required.

const cwd = process.cwd();
const STYLE_VERSION = 17;
const GALLERY_VERSION = 16;
const PERSON_ID = `${SITE_URL}/#person`;
const BLOG_ID = `${SITE_URL}/notes/#blog`;

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

// Image paths from the catalogue are already root-relative ("/images/…"); this
// is just a string coercion so the template helpers stay tidy.
const rootRel = (value) => String(value ?? "");

const prettyDate = (iso) => {
  const date = new Date(`${iso}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

function replaceBetween(source, marker, replacement) {
  const start = `<!-- ${marker}:start -->`;
  const end = `<!-- ${marker}:end -->`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);

  if (!pattern.test(source)) {
    throw new Error(`Marker ${start} … ${end} not found`);
  }

  return source.replace(pattern, `${start}\n${replacement}\n${end}`);
}

function pictureForViewer(photo) {
  const webp = rootRel(photo.srcWebpSrcset || photo.srcWebp);
  const jpeg = rootRel(photo.srcSrcset || photo.src);

  return `<picture>
        ${webp ? `<source type="image/webp" srcset="${escapeHtml(webp)}">` : ""}
        <img class="photo-page-image" src="${escapeHtml(rootRel(photo.src))}"${
    jpeg ? ` srcset="${escapeHtml(jpeg)}"` : ""
  } sizes="(max-width: 760px) calc(100vw - 2.8rem), min(80vw, 1100px)" alt="${escapeHtml(
    photo.alt
  )}"${photo.width ? ` width="${photo.width}"` : ""}${
    photo.height ? ` height="${photo.height}"` : ""
  } decoding="async">
      </picture>`;
}

function photoJsonLd(photo, relatedNotes = []) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Photograph",
    "@id": photo.url,
    url: photo.url,
    name: displayTitle(photo),
    description: photo.description,
    dateCreated: photo.date,
    creditText: photo.creator,
    creator: { "@id": PERSON_ID },
    copyrightHolder: { "@id": PERSON_ID },
    copyrightNotice: photo.rights,
    image: {
      "@type": "ImageObject",
      contentUrl: photo.imageUrl,
      url: photo.imageUrl,
      caption: photo.alt,
      ...(photo.width ? { width: photo.width } : {}),
      ...(photo.height ? { height: photo.height } : {}),
      creator: { "@id": PERSON_ID },
      copyrightNotice: photo.rights
    },
    ...(relatedNotes.length
      ? {
          subjectOf: relatedNotes.map((note) => ({
            "@type": "BlogPosting",
            "@id": note.url,
            url: note.url,
            name: displayNoteTitle(note)
          }))
        }
      : {})
  };

  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function relatedNotesList(notes) {
  if (!notes.length) {
    return "";
  }

  const items = notes
    .map(
      (note) => `          <li>
            <a href="${escapeHtml(note.path)}">${escapeHtml(displayNoteTitle(note))}</a>
            <time datetime="${escapeHtml(note.date)}">${escapeHtml(note.dateLabel)}</time>
          </li>`
    )
    .join("\n");

  return `
      <section class="related-notes" aria-labelledby="related-notes-title">
        <h2 id="related-notes-title">Related notes</h2>
        <ul>
${items}
        </ul>
      </section>`;
}

function photoPage(photo, previous, next, relatedNotes = []) {
  const label = displayTitle(photo);
  const pageTitle = photo.title ? `${photo.title} — John Braybrooke` : "Photograph — John Braybrooke";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(photo.description)}">
  <link rel="canonical" href="${escapeHtml(photo.url)}">
  <meta property="og:site_name" content="John Braybrooke">
  <meta property="og:title" content="${escapeHtml(label)}">
  <meta property="og:description" content="${escapeHtml(photo.description)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${escapeHtml(photo.url)}">
  <meta property="og:image" content="${escapeHtml(photo.imageUrl)}">
  <meta property="og:image:alt" content="${escapeHtml(photo.alt)}">${
    photo.width ? `\n  <meta property="og:image:width" content="${photo.width}">` : ""
  }${photo.height ? `\n  <meta property="og:image:height" content="${photo.height}">` : ""}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(label)}">
  <meta name="twitter:description" content="${escapeHtml(photo.description)}">
  <meta name="twitter:image" content="${escapeHtml(photo.imageUrl)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="stylesheet" href="/style.css?v=${STYLE_VERSION}">
  ${photoJsonLd(photo, relatedNotes)}
</head>
<body>
  <main class="site-shell">
    <header class="site-header">
      <a class="site-name" href="/">John Braybrooke</a>
      <nav class="site-nav" aria-label="Primary navigation">
        <a class="active" href="/" aria-current="page">Photos</a>
        <a href="/notes/">Notes</a>
        <a href="/about/">About</a>
      </nav>
    </header>

    <article class="photo-page">
      <figure class="photo-figure">
      ${pictureForViewer(photo)}
        <figcaption class="photo-caption">
          ${photo.title ? `<h1 class="photo-title">${escapeHtml(photo.title)}</h1>` : ""}
          <p class="photo-description">${escapeHtml(photo.description)}</p>
          <dl class="photo-meta">
            <div><dt>Date</dt><dd><time datetime="${escapeHtml(photo.date)}">${escapeHtml(
    prettyDate(photo.date)
  )}</time></dd></div>
            <div><dt>By</dt><dd>${escapeHtml(photo.creator)}</dd></div>
            <div><dt>Rights</dt><dd>${escapeHtml(photo.rights)}</dd></div>
          </dl>
        </figcaption>
      </figure>${relatedNotesList(relatedNotes)}
      <nav class="photo-pager" aria-label="Photograph navigation">
        ${previous ? `<a class="photo-pager-prev" rel="prev" href="${escapeHtml(`/photos/${previous.id}/`)}">Previous</a>` : `<span class="photo-pager-prev" aria-hidden="true"></span>`}
        <a class="photo-pager-all" href="/">All photographs</a>
        ${next ? `<a class="photo-pager-next" rel="next" href="${escapeHtml(`/photos/${next.id}/`)}">Next</a>` : `<span class="photo-pager-next" aria-hidden="true"></span>`}
      </nav>
    </article>
  </main>
</body>
</html>
`;
}

function gridItem(photo, index) {
  const webp = rootRel(photo.thumbWebpSrcset || photo.thumbWebp);
  const jpeg = rootRel(photo.thumbSrcset || photo.thumb || photo.src);
  const eager = index < 4;
  const priority = index < 2;

  return `      <figure class="photo-item">
        <a class="photo-link" data-photo-link data-photo-id="${escapeHtml(photo.id)}" href="${escapeHtml(
    `/photos/${photo.id}/`
  )}">
          <picture>
            ${webp ? `<source type="image/webp" srcset="${escapeHtml(webp)}">` : ""}
            <img src="${escapeHtml(rootRel(photo.thumb || photo.src))}"${
    jpeg ? ` srcset="${escapeHtml(jpeg)}"` : ""
  } sizes="(max-width: 760px) calc(100vw - 2.8rem), 180px" alt="${escapeHtml(
    photo.alt
  )}" width="900" height="600" loading="${eager ? "eager" : "lazy"}" fetchpriority="${
    priority ? "high" : "auto"
  }" decoding="async">
          </picture>
        </a>
      </figure>`;
}

function relatedPhotoThumb(photo) {
  const webp = rootRel(photo.thumbWebpSrcset || photo.thumbWebp);
  const jpeg = rootRel(photo.thumbSrcset || photo.thumb || photo.src);

  return `          <figure class="related-photo">
            <a href="${escapeHtml(`/photos/${photo.id}/`)}">
              <picture>
                ${webp ? `<source type="image/webp" srcset="${escapeHtml(webp)}">` : ""}
                <img src="${escapeHtml(rootRel(photo.thumb || photo.src))}"${
    jpeg ? ` srcset="${escapeHtml(jpeg)}"` : ""
  } sizes="(max-width: 760px) 44vw, 140px" alt="${escapeHtml(photo.alt)}" width="900" height="600" loading="lazy" decoding="async">
              </picture>
            </a>
          </figure>`;
}

function noteJsonLd(note, relatedPhotos) {
  const data = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": note.url,
    url: note.url,
    mainEntityOfPage: note.url,
    headline: displayNoteTitle(note),
    name: displayNoteTitle(note),
    description: note.summary,
    datePublished: note.date,
    dateCreated: note.date,
    author: { "@id": PERSON_ID },
    creator: { "@id": PERSON_ID },
    isPartOf: { "@id": BLOG_ID },
    ...(relatedPhotos.length
      ? {
          mentions: relatedPhotos.map((photo) => ({
            "@type": "Photograph",
            "@id": photo.url,
            url: photo.url,
            name: displayTitle(photo)
          }))
        }
      : {})
  };

  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function notesIndexJsonLd(notes) {
  const data = {
    "@context": "https://schema.org",
    "@type": ["CollectionPage", "Blog"],
    "@id": BLOG_ID,
    url: `${SITE_URL}/notes/`,
    name: "John Braybrooke — Notes",
    author: { "@id": PERSON_ID },
    blogPost: notes.map((note) => ({
      "@type": "BlogPosting",
      "@id": note.url,
      url: note.url,
      headline: displayNoteTitle(note),
      datePublished: note.date,
      description: note.summary,
      author: { "@id": PERSON_ID }
    }))
  };

  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function notePage(note, relatedPhotos) {
  const label = displayNoteTitle(note);
  const related = relatedPhotos.length
    ? `
      <section class="related-photos" aria-labelledby="related-photos-title">
        <h2 id="related-photos-title">Related photos</h2>
        <div class="related-photo-grid">
${relatedPhotos.map(relatedPhotoThumb).join("\n")}
        </div>
      </section>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(label)} — John Braybrooke</title>
  <meta name="description" content="${escapeHtml(note.summary)}">
  <link rel="canonical" href="${escapeHtml(note.url)}">
  <meta property="og:site_name" content="John Braybrooke">
  <meta property="og:title" content="${escapeHtml(label)}">
  <meta property="og:description" content="${escapeHtml(note.summary)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${escapeHtml(note.url)}">
  <meta property="og:image" content="${SITE_URL}/images/social-card.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="A photograph from John Braybrooke's photo site.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(label)}">
  <meta name="twitter:description" content="${escapeHtml(note.summary)}">
  <meta name="twitter:image" content="${SITE_URL}/images/social-card.jpg">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="stylesheet" href="/style.css?v=${STYLE_VERSION}">
  ${noteJsonLd(note, relatedPhotos)}
</head>
<body>
  <main class="site-shell">
    <header class="site-header">
      <a class="site-name" href="/">John Braybrooke</a>
      <nav class="site-nav" aria-label="Primary navigation">
        <a href="/">Photos</a>
        <a class="active" href="/notes/" aria-current="page">Notes</a>
        <a href="/about/">About</a>
      </nav>
    </header>

    <article class="note-page">
      <header class="note-header">
        <p class="note-kicker"><time datetime="${escapeHtml(note.date)}">${escapeHtml(note.dateLabel)}</time></p>
        <h1>${escapeHtml(label)}</h1>
      </header>
      <div class="note-prose">
${note.bodyHtml
  .split("\n")
      .map((line) => `        ${line}`)
      .join("\n")}
      </div>${related}
    </article>
  </main>
</body>
</html>
`;
}

function notesIndexPage(notes) {
  const content = notes.length
    ? `<section class="notes-page" aria-labelledby="notes-title">
      <h1 class="visually-hidden" id="notes-title">Notes</h1>
      <div class="notes-list">
${notes
  .map(
    (note) => `        <article class="note-list-item">
          <time datetime="${escapeHtml(note.date)}">${escapeHtml(note.dateLabel)}</time>
          <h2><a href="${escapeHtml(note.path)}">${escapeHtml(displayNoteTitle(note))}</a></h2>
          <p>${escapeHtml(note.summary)}</p>
        </article>`
  )
  .join("\n")}
      </div>
    </section>`
    : `<section class="empty-state empty-notes" aria-labelledby="notes-title">
      <h1 id="notes-title">Notes</h1>
      <p>No notes yet.</p>
    </section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Notes — John Braybrooke</title>
  <meta name="description" content="Field notes and observations by John Braybrooke.">
  <link rel="canonical" href="${SITE_URL}/notes/">
  <meta property="og:site_name" content="John Braybrooke">
  <meta property="og:title" content="Notes — John Braybrooke">
  <meta property="og:description" content="Field notes and observations by John Braybrooke.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE_URL}/notes/">
  <meta property="og:image" content="${SITE_URL}/images/social-card.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="A photograph from John Braybrooke's photo site.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Notes — John Braybrooke">
  <meta name="twitter:description" content="Field notes and observations by John Braybrooke.">
  <meta name="twitter:image" content="${SITE_URL}/images/social-card.jpg">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="stylesheet" href="/style.css?v=${STYLE_VERSION}">
  ${notesIndexJsonLd(notes)}
</head>
<body>
  <main class="site-shell">
    <header class="site-header">
      <a class="site-name" href="/">John Braybrooke</a>
      <nav class="site-nav" aria-label="Primary navigation">
        <a href="/">Photos</a>
        <a class="active" href="/notes/" aria-current="page">Notes</a>
        <a href="/about/">About</a>
      </nav>
    </header>

    ${content}
  </main>
</body>
</html>
`;
}

function homepageJsonLd(photos, notes) {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        "@id": PERSON_ID,
        name: "John Braybrooke",
        url: `${SITE_URL}/`,
        sameAs: []
      },
      {
        "@type": ["CollectionPage", "ImageGallery"],
        "@id": `${SITE_URL}/#gallery`,
        url: `${SITE_URL}/`,
        name: "John Braybrooke — Photographs",
        author: { "@id": PERSON_ID },
        hasPart: photos.map((photo) => ({
          "@type": "ImageObject",
          "@id": photo.url,
          contentUrl: photo.imageUrl,
          url: photo.url,
          name: displayTitle(photo),
          caption: photo.alt,
          description: photo.description,
          dateCreated: photo.date,
          creditText: photo.creator
        }))
      },
      {
        "@type": "Blog",
        "@id": BLOG_ID,
        url: `${SITE_URL}/notes/`,
        name: "John Braybrooke — Notes",
        author: { "@id": PERSON_ID },
        blogPost: notes.map((note) => ({
          "@type": "BlogPosting",
          "@id": note.url,
          url: note.url,
          headline: displayNoteTitle(note),
          datePublished: note.date,
          description: note.summary
        }))
      }
    ]
  };

  return `<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n</script>`;
}

function noteJson(note) {
  return {
    id: note.id,
    url: note.url,
    title: note.title,
    displayTitle: displayNoteTitle(note),
    date: note.date,
    summary: note.summary,
    body: note.body,
    creator: note.creator,
    related_photos: note.related_photos
  };
}

function sitemap(photos, notes) {
  const urls = [
    { loc: `${SITE_URL}/` },
    { loc: `${SITE_URL}/about/` },
    { loc: `${SITE_URL}/notes/` },
    ...photos.map((photo) => ({ loc: photo.url, lastmod: photo.date })),
    ...notes.map((note) => ({ loc: note.url, lastmod: note.date }))
  ];

  const body = urls
    .map(
      (entry) =>
        `  <url>\n    <loc>${escapeHtml(entry.loc)}</loc>${
          entry.lastmod ? `\n    <lastmod>${escapeHtml(entry.lastmod)}</lastmod>` : ""
        }\n  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function imageSitemap(photos) {
  const body = photos
    .map(
      (photo) =>
        `  <url>\n    <loc>${escapeHtml(photo.url)}</loc>\n    <image:image>\n      <image:loc>${escapeHtml(
          photo.imageUrl
        )}</image:loc>\n      <image:title>${escapeHtml(
          displayTitle(photo)
        )}</image:title>\n      <image:caption>${escapeHtml(
          photo.description
        )}</image:caption>\n    </image:image>\n  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${body}\n</urlset>\n`;
}

const robots = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
Sitemap: ${SITE_URL}/image-sitemap.xml
`;

function notesByPhoto(notes) {
  const map = new Map();

  for (const note of notes) {
    for (const photoId of note.related_photos) {
      if (!map.has(photoId)) {
        map.set(photoId, []);
      }

      map.get(photoId).push(note);
    }
  }

  return map;
}

function photosById(photos) {
  return new Map(photos.map((photo) => [photo.id, photo]));
}

async function pruneNotePages(notes) {
  const liveIds = new Set(notes.map((note) => note.id));
  const entries = await readdir(path.join(cwd, "notes"), { withFileTypes: true }).catch(() => []);
  let removed = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || !noteFilenameLike(entry.name)) {
      continue;
    }

    if (!liveIds.has(entry.name)) {
      await rm(path.join(cwd, "notes", entry.name), { recursive: true, force: true });
      console.log(`removed orphan note page notes/${entry.name}/`);
      removed += 1;
    }
  }

  return removed;
}

function noteFilenameLike(value) {
  return /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function llms(photos, notes) {
  const photoLines = photos
    .map((photo) => `- [${displayTitle(photo)}](${photo.url}): ${photo.description}`)
    .join("\n");
  const noteLines = notes.length
    ? notes.map((note) => `- [${displayNoteTitle(note)}](${note.url}): ${note.summary}`).join("\n")
    : "No public notes yet.";

  return `# John Braybrooke

> Street and observational photography and field notes by John Braybrooke.
> Each photograph and note has a standalone page with crawlable metadata.

## Photographs

${photoLines}

## Notes

${noteLines}

## Machine-readable

- Catalogue (JSON): ${SITE_URL}/data/photos.json
- Notes catalogue (JSON): ${SITE_URL}/data/notes.json
- Sitemap: ${SITE_URL}/sitemap.xml
- Image sitemap: ${SITE_URL}/image-sitemap.xml
`;
}

// --- run ---------------------------------------------------------------------

const photos = await loadPhotos();
const notes = await loadNotes(photos);
const noteMap = notesByPhoto(notes);
const photoMap = photosById(photos);

// Standalone photo pages.
for (let index = 0; index < photos.length; index += 1) {
  const photo = photos[index];
  const previous = index > 0 ? photos[index - 1] : null;
  const next = index < photos.length - 1 ? photos[index + 1] : null;
  const relatedNotes = noteMap.get(photo.id) || [];
  const directory = path.join(cwd, "photos", photo.id);

  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), photoPage(photo, previous, next, relatedNotes));
}

// Notes index and standalone note pages.
await mkdir(path.join(cwd, "notes"), { recursive: true });
await writeFile(path.join(cwd, "notes", "index.html"), notesIndexPage(notes));

for (const note of notes) {
  const relatedPhotos = note.related_photos.map((photoId) => photoMap.get(photoId)).filter(Boolean);
  const directory = path.join(cwd, "notes", note.id);

  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), notePage(note, relatedPhotos));
}

const prunedNotes = await pruneNotePages(notes);

// Homepage: inject the real grid and the gallery JSON-LD between markers.
const indexPath = path.join(cwd, "index.html");
let indexHtml = await readFile(indexPath, "utf8");
const grid = photos.map((photo, index) => gridItem(photo, index)).join("\n");
indexHtml = replaceBetween(indexHtml, "photos", grid);
indexHtml = replaceBetween(indexHtml, "jsonld", `  ${homepageJsonLd(photos, notes)}`);
indexHtml = indexHtml.replace(/photo-gallery\.js\?v=\d+/g, `photo-gallery.js?v=${GALLERY_VERSION}`);
indexHtml = indexHtml.replace(/style\.css\?v=\d+/g, `style.css?v=${STYLE_VERSION}`);
await writeFile(indexPath, indexHtml);

// Crawl artifacts.
await mkdir(path.join(cwd, "data"), { recursive: true });
await writeFile(path.join(cwd, "data", "notes.json"), `${JSON.stringify(notes.map(noteJson), null, 2)}\n`);
await writeFile(path.join(cwd, "sitemap.xml"), sitemap(photos, notes));
await writeFile(path.join(cwd, "image-sitemap.xml"), imageSitemap(photos));
await writeFile(path.join(cwd, "robots.txt"), robots);
await writeFile(path.join(cwd, "llms.txt"), llms(photos, notes));

console.log(
  `Generated ${photos.length} photo page${
    photos.length === 1 ? "" : "s"
  }, ${notes.length} note page${notes.length === 1 ? "" : "s"}, homepage grid, sitemap.xml, image-sitemap.xml, robots.txt, llms.txt.`
);

if (prunedNotes) {
  console.log(`Pruned ${prunedNotes} orphaned note page${prunedNotes === 1 ? "" : "s"}.`);
}
