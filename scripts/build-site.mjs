import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { loadPhotos, displayTitle, SITE_URL } from "./lib/photos.mjs";

// Generate the crawlable, no-JS layer of the site from the catalogue:
//   - /photos/<id>/index.html   standalone page per photograph
//   - index.html                real <a><img> grid + gallery JSON-LD (injected)
//   - sitemap.xml, image-sitemap.xml, robots.txt, llms.txt
// The JS overlay viewer is layered on top of this and is never required.

const cwd = process.cwd();
const STYLE_VERSION = 16;
const GALLERY_VERSION = 16;

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

function photoJsonLd(photo) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Photograph",
    "@id": photo.url,
    url: photo.url,
    name: displayTitle(photo),
    description: photo.description,
    dateCreated: photo.date,
    creditText: photo.creator,
    creator: { "@type": "Person", name: photo.creator, url: `${SITE_URL}/about/` },
    copyrightHolder: { "@type": "Person", name: photo.creator },
    copyrightNotice: photo.rights,
    image: {
      "@type": "ImageObject",
      contentUrl: photo.imageUrl,
      url: photo.imageUrl,
      caption: photo.alt,
      ...(photo.width ? { width: photo.width } : {}),
      ...(photo.height ? { height: photo.height } : {}),
      creator: { "@type": "Person", name: photo.creator },
      copyrightNotice: photo.rights
    }
  };

  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function photoPage(photo, previous, next) {
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
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/style.css?v=${STYLE_VERSION}">
  ${photoJsonLd(photo)}
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
      </figure>
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

function homepageJsonLd(photos) {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        "@id": `${SITE_URL}/#person`,
        name: "John Braybrooke",
        url: `${SITE_URL}/`,
        sameAs: []
      },
      {
        "@type": ["CollectionPage", "ImageGallery"],
        "@id": `${SITE_URL}/#gallery`,
        url: `${SITE_URL}/`,
        name: "John Braybrooke — Photographs",
        author: { "@id": `${SITE_URL}/#person` },
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
      }
    ]
  };

  return `<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n</script>`;
}

function sitemap(photos) {
  const urls = [
    { loc: `${SITE_URL}/` },
    { loc: `${SITE_URL}/about/` },
    { loc: `${SITE_URL}/notes/` },
    ...photos.map((photo) => ({ loc: photo.url, lastmod: photo.date }))
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

function llms(photos) {
  const lines = photos
    .map((photo) => `- [${displayTitle(photo)}](${photo.url}): ${photo.description}`)
    .join("\n");

  return `# John Braybrooke

> Street and observational photography by John Braybrooke. Each photograph has a
> standalone page with a literal description, capture date, and structured data.

## Photographs

${lines}

## Machine-readable

- Catalogue (JSON): ${SITE_URL}/data/photos.json
- Sitemap: ${SITE_URL}/sitemap.xml
- Image sitemap: ${SITE_URL}/image-sitemap.xml
`;
}

// --- run ---------------------------------------------------------------------

const photos = await loadPhotos();

// Standalone photo pages.
for (let index = 0; index < photos.length; index += 1) {
  const photo = photos[index];
  const previous = index > 0 ? photos[index - 1] : null;
  const next = index < photos.length - 1 ? photos[index + 1] : null;
  const directory = path.join(cwd, "photos", photo.id);

  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), photoPage(photo, previous, next));
}

// Homepage: inject the real grid and the gallery JSON-LD between markers.
const indexPath = path.join(cwd, "index.html");
let indexHtml = await readFile(indexPath, "utf8");
const grid = photos.map((photo, index) => gridItem(photo, index)).join("\n");
indexHtml = replaceBetween(indexHtml, "photos", grid);
indexHtml = replaceBetween(indexHtml, "jsonld", `  ${homepageJsonLd(photos)}`);
indexHtml = indexHtml.replace(/photo-gallery\.js\?v=\d+/g, `photo-gallery.js?v=${GALLERY_VERSION}`);
indexHtml = indexHtml.replace(/style\.css\?v=\d+/g, `style.css?v=${STYLE_VERSION}`);
await writeFile(indexPath, indexHtml);

// Crawl artifacts.
await writeFile(path.join(cwd, "sitemap.xml"), sitemap(photos));
await writeFile(path.join(cwd, "image-sitemap.xml"), imageSitemap(photos));
await writeFile(path.join(cwd, "robots.txt"), robots);
await writeFile(path.join(cwd, "llms.txt"), llms(photos));

console.log(
  `Generated ${photos.length} photo page${
    photos.length === 1 ? "" : "s"
  }, homepage grid, sitemap.xml, image-sitemap.xml, robots.txt, llms.txt.`
);
