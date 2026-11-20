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
├── photos/            # Generated standalone page per photo (/photos/15/), plus
│                      #   redirects from the old /photos/photo-00001/ addresses
├── notes/             # Generated notes index and standalone note pages
├── sitemap.xml, image-sitemap.xml, robots.txt, llms.txt   # Generated
├── images/
│   ├── new/           # Drop new photos here (ignored by git)
│   ├── photos/        # Numbered originals, ignored by git
│   ├── large/         # Generated viewer + zoom images
│   └── thumbs/        # Generated grid images
└── scripts/
    ├── build.mjs                  # One command: runs everything below
    ├── lib/photos.mjs             # Shared: joins images + metadata, validates
    ├── rename-photos.mjs          # Numbers new photos, moves them into images/photos/
    ├── build-photo-images.mjs     # Makes thumbnails + large images (new/changed only)
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

### Adding

1. Drop the new photos into `images/new/`. Any name is fine (`IMG_8224.jpeg`,
   iPhone `.HEIC`, `.png`, …).
2. Run `node scripts/build.mjs`. It gives each photo its permanent number and
   moves it into `images/photos/`, makes the web-sized copies, and creates a
   metadata file `content/photos/<id>.md` with the date filled in from the
   photo. Then it stops and lists which photos still need words.
3. In each new `content/photos/<id>.md`, fill in `alt` (one line: what's in the
   picture, for screen readers) and `description` (a few sentences). `title` is
   optional; blank shows as "Untitled".
4. Run `node scripts/build.mjs` again. This time it finishes and the photos are
   on the site.

The build deliberately refuses to publish a photo without a description.

New photos are numbered in filename order, which for camera files
(`IMG_8224`, `IMG_8640`, …) is the order they were taken. Dropping files straight
into `images/photos/` also works.

### Removing

Delete (or move to the Trash) the photo's original from `images/photos/`, then
run `node scripts/build.mjs`. The build removes its thumbnails, large images and
page.

The gap this leaves in the numbering (e.g. no photo 7) is deliberate:
visitors never see the numbers in the grid, but they are in each photo's address
(`/photos/8/`), so renumbering would break links people have shared, and
reusing a number would make an old link show a different picture. Each number is
used once, ever, even if you delete the newest photo. The removed photo's
`content/photos/<id>.md` stays behind; that keeps its number reserved and its
description ready if you ever put the photo back (drop the original into
`images/photos/` under its old name, `7.jpg`).

### Addresses

Each photo's number is its address: `/photos/15/`, with its files at
`images/photos/15.jpg` and `content/photos/15.md`. Until November 2026 the
addresses were `/photos/photo-00001/` and so on; photos 1–14 still have a tiny
page at their old address that forwards to the new one, so shared links keep
working. That is handled by the build (`LAST_OLD_STYLE_ID` in
`scripts/build-site.mjs`) and needs no attention.

### What the build does

1. Numbers new photos (`15.jpg`, `16.jpg`, …) and moves them
   into `images/photos/`.
2. Makes the grid thumbnails (`images/thumbs/`) and large viewer images
   (`images/large/`), plus WebP copies if `cwebp` is installed. **Only new or
   changed photos are processed.** Re-encoding never produces identical bytes, so
   redoing every photo each time would make git see every image as changed, grow
   the repository, and make visitors re-download photos that didn't change. To
   force a photo to be redone, delete its copies or replace its original.
3. Creates the metadata file for each new photo.
4. Deletes the images and pages of removed photos.
5. Rebuilds `data/photos.json`, the photo pages (`/photos/<id>/`), the homepage
   grid, and `sitemap.xml` / `image-sitemap.xml` / `robots.txt` / `llms.txt`.

The originals in `images/new/` and `images/photos/` are ignored by git and never
published; only the generated images, pages and metadata are.

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
related_photos: ["4", "8"]
```

The relationship has one source of truth: notes point to photos. The build uses
that to generate both the related photo thumbnails on note pages and the related
note links on photo pages.

Note bodies support a small Markdown subset: paragraphs, `[links](https://...)`
or `[links](/notes/)`, `**bold**`, and `*italic*`. Raw HTML is escaped.

## Copyist

`copyist/` is a typing tool: you copy out a text and it inks from grey to black as
you go. It is plain HTML, CSS and JavaScript with no build step. Progress and
your own uploaded texts stay in the browser (localStorage and IndexedDB).

The library in `copyist/texts/` is generated from Project Gutenberg plain-text
files (#10 King James Bible, #100 Complete Works of Shakespeare, #731–736
Gibbon). The source files are not committed. To rebuild, put them in one folder
as `kjv.txt`, `shakespeare.txt` and `gibbon1.txt`…`gibbon6.txt`, then run:

```sh
node scripts/copyist-texts.mjs path/to/that/folder
```

The script strips the Gutenberg wrapper, introductions, cast lists and Gibbon's
footnotes, and writes one JSON file per Bible book, play or poem, and Gibbon
chapter, plus `copyist/texts/manifest.json`.

## Local Development

Serve the folder with any static server, or open the HTML files directly.
