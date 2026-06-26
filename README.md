# John Braybrooke

A quiet static photography and notes site for John Braybrooke.

## Structure

```
.
├── index.html    # Photos home
├── photos.html   # Photos alias
├── notes/        # Notes
├── about/        # About
├── notes.html    # Notes redirect
├── about.html    # About redirect
├── style.css     # Shared styles
├── data/
│   └── photos.json
├── images/
│   ├── photos/   # Local source files, ignored by git
│   ├── large/    # Generated viewer images
│   ├── zoom/     # Generated zoom images
│   └── thumbs/   # Generated grid images
└── scripts/
    ├── build-photo-manifest.mjs
    ├── build-photo-large.mjs
    ├── build-photo-thumbnails.mjs
    └── rename-photos.mjs
```

## Adding Photos

Put image files in `images/photos/`, then run:

```sh
node scripts/rename-photos.mjs
```

That renames new files to `photo-00001.jpg`, `photo-00002.jpg`, and so on. Then run:

```sh
node scripts/build-photo-thumbnails.mjs
node scripts/build-photo-large.mjs
node scripts/build-photo-zoom.mjs
node scripts/build-photo-manifest.mjs
```

The thumbnail script writes responsive grid images to `images/thumbs/`. The large-image script writes responsive viewer images to `images/large/`. The zoom-image script writes higher-resolution inspection images to `images/zoom/`. If `cwebp` is installed, these scripts also write WebP copies beside the JPEG fallbacks. The manifest script updates `data/photos.json` with the available `srcset` data.

The original files in `images/photos/` are source material and are ignored by git, so they do not get published to the site.

## Local Development

Serve the folder with any static server, or open the HTML files directly.
