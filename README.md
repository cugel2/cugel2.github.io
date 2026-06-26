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
│   ├── large/    # Generated viewer + zoom images
│   └── thumbs/   # Generated grid images
└── scripts/
    ├── build.mjs               # One command: runs everything below
    ├── rename-photos.mjs
    ├── build-photo-thumbnails.mjs
    ├── build-photo-large.mjs
    └── build-photo-manifest.mjs
```

## Adding and Removing Photos

`images/photos/` is the source of truth. To add photos, drop the files in there. To remove photos, delete the files from there. Either way, then run one command:

```sh
node scripts/build.mjs
```

That does the whole pipeline:

1. Renames any new files to `photo-00001.jpg`, `photo-00002.jpg`, and so on.
2. Regenerates the grid thumbnails (`images/thumbs/`) and the large viewer images (`images/large/`). The large images double as the zoom source, so there is no separate zoom tier.
3. Deletes generated images left behind by photos you removed.
4. Rebuilds `data/photos.json` to match what is on disk.

If `cwebp` is installed, the build also writes WebP copies beside the JPEG fallbacks. The original files in `images/photos/` are ignored by git, so they are never published — only the generated images and the manifest are.

Deleting a photo leaves a gap in the numbering (e.g. `photo-00003` missing). That is harmless: photos are ordered by filename and new photos always take the next unused number, so nothing is ever renumbered or reused.

You can still run the individual `build-photo-*.mjs` and `rename-photos.mjs` scripts on their own, but `build.mjs` is the normal path.

## Local Development

Serve the folder with any static server, or open the HTML files directly.
