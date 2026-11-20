# Nicolaides

A daily course player for Kimon Nicolaides' *The Natural Way to Draw* on iPad with Apple Pencil: press **Start** each day and draw. It runs the book's timetable block by block, deals Muybridge poses, keeps every sheet, and resumes to the second after any break. Served at `/nicolaides/`; local-first, no accounts or uploads.

Stage 1 (this version): the whole course runs; Schedules 1–3 are complete, with each block drawn in its medium (fine and blunt pencil, lithograph crayon), the flash pose and potential gesture. Later behaviours (memory poses, looped action, right-angle pairs…), watercolour and oil, and non-figure references come in later stages, each ready before the course reaches it.

## How a day works

- **The course** is the book's 25 schedules × days A–E, each three hours of timed blocks (`src/data/course.json`, compacted from the research package by `scripts/build-course.mjs`). Schedule 10 is in twice, as the book requires; **Course → Add a repeat** adds more of any schedule.
- **Start** runs the current block; blocks follow each other with no gap. The clock counts wall-clock time, so **Pause**, leaving the app or closing it stops it exactly where it was (it also stops when the page is hidden).
- **Rest** blocks are pause points: the clock stops and **Start** goes on to the next block. The end of a day stops it too, and the next Start begins the next day. There is no calendar: missing days changes nothing.
- **Course** can restart or skip the current block, or go to any day.
- Where the table gives a range (1–2, 3–5) the larger count is used: shorter poses. The exception is the "one- or five-minute" exercises (straight and curved, predominating shape): a range there warms up with one-minute poses, then spends about two-thirds of the block on five-minute ones (10 × 1 then 4 × 5 minutes in half an hour).
- Poses last as long as the book says (`POSE_SECONDS` in `src/core/course.ts`): gesture, potential gesture, gesture of the features and black-and-white gesture one minute; moving action three minutes; oil and coloured-paper gestures five minutes; straight-and-curve and predominating-shape one minute in blocks of 15 or more, otherwise five (or the mix above). The rest of the block was changeover time for a live model, so the block ends when its poses are done: 25 one-minute gestures make a 25-minute block. Exercises with no stated length share the block evenly and keep its full time.
- Homework (the daily composition and so on) is only named on Day A's card; it is done off the app.

## Poses

From Northwestern University Libraries' [Muybridge in Motion](https://nulib-ds.github.io/muybridge/) (781 plates of *Animal Locomotion*; images served by the National Gallery of Art, Smithsonian and Boston Public Library IIIF servers, which allow cross-origin use). `scripts/fetch-muybridge.mjs` downloads the IIIF manifests into `research/`; `scripts/build-muybridge.mjs` writes `src/public/data/muybridge.json` with every plate's frames (IIIF region, camera row, column, timing).

- Left out of the pose pool: medical plates (537–562), plates with children, plain walking, standing, and the hand-only close-ups. Animals are in. That leaves 695 plates, 17,236 frames.
- A plate is one action from two to six cameras at once, about twelve frames per camera row; neighbouring frames are nearly the same pose. So a day never takes two frames from one plate. Plates are dealt from a shuffled deck kept across days (every plate once before any returns), and a returning plate gives a frame not shown before (`src/core/poses.ts`).
- **Skip pose** replaces a pose that makes no sense with a fresh plate and starts the pose's time again. It retires the skipped frame and its two neighbours either side from the same camera (nearly the same pose); a second skip from that camera retires the camera's whole row, since then the view is the trouble (a carriage seen from behind). Other cameras and other moments of the action stay in the deck. Settings → Skipped poses brings them all back.
- A day's poses are chosen when the day comes up and fetched ahead into the Cache API, so the day works offline; frames from other days are dropped. Carried-on artworks (the five-hour contour, long ink and watercolour studies) keep one pose across their days.
- Blocks whose subject Muybridge cannot supply yet (drapery, anatomy, heads, reproductions, colour, imagination) give the whole screen to drawing, marked "your own reference".

## Drawing

- Pencil only; a finger or palm does nothing.
- Each block is drawn in its medium with p5.brush (`src/core/brushes.ts`, shared with the brush test), on cream manila: contour exercises with a fine-pointed pencil (about 0.6 mm), gesture with a blunt one (about 1 mm), Weight with the side of a lithograph crayon, the modelled drawing with its end; ink and black crayon are ready for later schedules, and watercolour and oil draw in pencil until their stage. The sheet records its medium.
- Brush marks are random, so each stroke is cut into overlapping spline pieces with a seed per piece (`src/core/strokePieces.ts`); live drawing and every re-draw (Undo, the gallery, Save to Photos) cut and seed them identically, from samples rounded as they are stored, so a sheet always looks as it was drawn.
- The sheet's canvas is made at the sheet's own size and shown scaled to fit, so rotating never redraws it, and the Pencil is mapped through where the canvas is on screen.
- Several drawings go on one sheet until **New sheet**; a new block starts a new sheet.
- Whenever a sheet with drawing on it is set aside (New sheet, or its block ending), a **Save last sheet to Photos** offer appears at the foot of the drawing pane for 30 seconds. It never stops the clock or the drawing; the picture is made ahead so one tap opens the share sheet (where sharing is unavailable it opens the sheet in the gallery viewer instead).
- **Contour** (Exercises 1, 17, 18) is blind: the sheet's canvas is hidden while you draw (strokes still go onto it). **Peek** shows it for 3 seconds.
- **The Flash Pose** (Exercise 5) shows each pose for one second, then covers it: "Draw it from memory". It stays covered while paused.
- **Potential Gesture** (Exercise 4): draw what the figure does next; in each pose's last 10 seconds the plate's own later frame (four frames on, same camera) shows "What came next".
- **Undo** is hidden before Exercise 28 (the book allows no eraser until then); Settings can turn it on earlier.
- **Real life** (Settings → References, per exercise): no reference in the app, the whole screen for drawing, for your own model, mirror or subject.
- Layout follows the iPad: landscape puts the drawing on the drawing hand's side (left by default) and the reference on the other; portrait puts the reference on top.

Every Pencil sample is kept (position, pressure, altitude, azimuth, timing; packed as an `Int16Array`, six numbers a point), so sheets can be drawn again with other brushes later.

## Gallery, Save to Photos, data

- **Gallery** lists every sheet by book day. A sheet opens with **Save to Photos** (a PNG about 2,000 px on the long side, re-drawn from the strokes with the same brushes) and, for a one-pose sheet, **Save with reference** (drawing and pose side by side, on the same sides as in the app). On the iPad over https this opens the share sheet: choose **Save Image**. Over plain http the picture is shown instead; press and hold it to save.
- IndexedDB database `nicolaides`: store `kv` (progress, settings, the pose deck, each day's poses, carried-on artworks) and store `sheets`. **Settings → Export all data** writes everything to one JSON file (strokes base64-encoded).

## Brush test

`/nicolaides/brush-test/` (linked from Settings) tries [p5.brush](https://github.com/acamposuribe/p5.brush) (MIT) presets with the Pencil: pencils, charcoal, crayon, pastel, pens, marker and a watercolour wash (outline a shape). It links to the [Hokusai](https://reearth.github.io/hokusai/) demo (MyPaint brushes in WebAssembly) for comparison. Two kinds of brush. **Line** brushes (pencils 2B and HB, dip pen, technical pen) follow Circle Trainer's Tapers: a light touch is enough (Pencil pressure 0.03–0.5 covers the whole range), and each is tuned to a measured width at a light touch: 2B 0.8 mm, HB 0.5, dip pen 0.45, technical pen 0.6. **Layered** brushes (charcoal, crayon, pastel/Conté, marker) keep p5.brush's own gentle response, faint per pass, so several passes build tone without going solid black; pastel is narrowed to about 5 mm. `measureBrushes()` in the console re-measures the widths. The app draws with the same settings.

## Development

```sh
npm install
npm run dev          # http://<mac>:5175 over Wi-Fi
npm run dev:https    # port 5176, for the share sheet on the iPad
npm test
npm run build        # writes the deployable page into this folder
npm run data         # rebuild course.json and muybridge.json from research/
```

The build output (`index.html`, `assets/`, `data/`, `brush-test/`, manifest, service worker) is committed and served by GitHub Pages. `research/` (the research package and fetched manifests) is not committed.
