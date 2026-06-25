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
node scripts/build-photo-manifest.mjs
```

The thumbnail script writes web-sized grid images to `images/thumbs/`. The large-image script writes viewer images to `images/large/`. The manifest script updates `data/photos.json`.

The original files in `images/photos/` are source material and are ignored by git, so they do not get published to the site.

## Local Development

Serve the folder with any static server, or open the HTML files directly.
