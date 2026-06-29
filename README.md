# John Braybrooke

A quiet static photography and notes site for John Braybrooke.

## Structure

```
.
├── index.html         # Photos home (grid is generated into it)
├── photos.html        # Redirect to /
├── about/             # About
├── notes.html         # Notes redirect
├── about.html         # About redirect
├── style.css          # Shared styles
├── photo-gallery.js   # Enhances the grid into the overlay viewer
├── content/
│   ├── photos/        # Canonical per-photo metadata (one .md per photo)
│   └── notes/         # Canonical field notes (one .md per note)
├── data/
│   ├── photos.json    # Generated public photo catalogue
│   └── notes.json     # Generated public notes catalogue
├── photos/            # Generated standalone page per photo (/photos/<id>/)
├── notes/             # Generated notes index and standalone note pages
├── sitemap.xml, image-sitemap.xml, robots.txt, llms.txt   # Generated
├── images/
│   ├── photos/        # Local source files, ignored by git
│   ├── large/         # Generated viewer + zoom images
│   └── thumbs/        # Generated grid images
└── scripts/
    ├── build.mjs                  # One command: runs everything below
    ├── lib/photos.mjs             # Shared: joins images + metadata, validates
    ├── rename-photos.mjs
    ├── build-photo-thumbnails.mjs
    ├── build-photo-large.mjs
    ├── scaffold-photos.mjs        # Creates a metadata stub for each new photo
    ├── build-photo-manifest.mjs   # Writes data/photos.json
    └── build-site.mjs             # Writes generated pages, sitemaps, robots, llms
```

The main sources of truth are `images/photos/` (the original image files, ignored
by git), `content/photos/` (photo metadata), and `content/notes/` (field notes).
Everything else under `images/`, plus `photos/`, generated pages under `notes/`,
`data/*.json`, and the sitemap/robots/llms files, is generated and safe to
delete — the build recreates it.

## Adding and Removing Photos

To add photos, drop the files into `images/photos/`. To remove photos, delete
them from there. Either way, then run one command:

```sh
node scripts/build.mjs
```

That does the whole pipeline:

1. Renames any new files to `photo-00001.jpg`, `photo-00002.jpg`, and so on.
2. Regenerates the grid thumbnails (`images/thumbs/`) and the large viewer images
   (`images/large/`). The large images double as the zoom source, so there is no
   separate zoom tier.
3. Scaffolds a metadata stub at `content/photos/<id>.md` for each new photo,
   prefilling the capture date from EXIF.
4. Deletes generated images and pages left behind by photos you removed.
5. Rebuilds `data/photos.json`, the standalone photo pages (`/photos/<id>/`), the
   homepage grid, and `sitemap.xml` / `image-sitemap.xml` / `robots.txt` /
   `llms.txt`.

**A new photo won't build until its metadata is filled in.** Each
`content/photos/<id>.md` needs a non-empty `alt` and `description` (and a `date`,
which EXIF usually fills automatically). The build fails with a list of what's
missing — this is deliberate, so no photo publishes without a description. A
`title` is optional; blank just shows as "Untitled" and never affects the URL.

If `cwebp` is installed, the build also writes WebP copies beside the JPEG
fallbacks. The original files in `images/photos/` are ignored by git, so they are
never published — only the generated images, pages, and metadata are.

Deleting a photo leaves a gap in the numbering (e.g. `photo-00003` missing). That
is harmless: photos are ordered by filename and new photos always take the next
unused number, so nothing is ever renumbered or reused. The deleted photo's
`content/photos/<id>.md` is left in place (so its description survives if you
re-add it); the generated page and images are pruned.

## Adding Notes

Notes live in `content/notes/`. Create one Markdown file per note with a stable
dated slug:

```txt
content/notes/2026-06-24-emotional-support-socks.md
```

The filename becomes the URL:

```txt
/notes/2026-06-24-emotional-support-socks/
```

Use this frontmatter:

```md
---
date: "2026-06-24"
title: ""
summary: ""
related_photos: []
---

Your note goes here.
```

`date` and the note body are required. `title`, `summary`, and
`related_photos` are optional. If `summary` is blank, the build derives one from
the body. If `related_photos` is present, every ID must match an existing photo,
for example:

```md
related_photos: ["photo-00004", "photo-00007"]
```

The relationship has one source of truth: notes point to photos. The build uses
that to generate both the related photo thumbnails on note pages and the related
note links on photo pages.

Note bodies support a small Markdown subset: paragraphs, `[links](https://...)`
or `[links](/notes/)`, `**bold**`, and `*italic*`. Raw HTML is escaped.

## Local Development

Serve the folder with any static server, or open the HTML files directly.
