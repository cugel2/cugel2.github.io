# Circle Trainer

Circle Trainer is a local-first Apple Pencil motor-practice tool for iPad Safari. It trains large, committed lines, arcs, circles, ellipses, and S curves without showing a path that can be traced, plus a Box drill for mental rotation of simple forms and a scoreless Copy mode for copying from a picture.

The app is self-contained under `/circle-trainer/`. It does not add analytics, create accounts, or upload Pencil data.

## Practice loop

1. Small hollow checkpoints specify the movement.
2. The user draws one committed Pencil stroke while the ideal path remains hidden.
3. On `pointerup`, the raw stroke freezes and the ideal path appears in dashed blue.
4. The execution gate rejects incomplete or implausible movements. Optional correction rejection can also reject substantial backtracking; it defaults off.
5. Passing strokes receive a versioned 0–100 accuracy score.
6. The target, raw samples, schedule context, metrics, gate result, and score are saved locally.

### Box drill (hinge swing)

1. The reference half shows a complete reference box — all 12 edges — in thin grey. The edges a solid box would hide are drawn fainter, and the visible face with the largest projected area is shaded in light see-through grey, so the wireframe reads one way only. One edge, the hinge, is thick orange. A curved orange arrow (dot to arrowhead) shows which way the box swings about the hinge, with the angle (30°, 45° or 60°). It follows the far edge's path just outside the box, from 20° before the current position to 20° into the swing, so it shows direction without giving away the answer.
2. The drawing half shows only the hinge, as the identical 2D segment translated. It sits at the same place relative to its half as in the reference, so its position gives nothing away.
3. The user draws the other 11 edges of the swung box from imagination, one stroke each, in any order. The status line shows progress (`Box · 4/11`). Strokes with fewer than 8 samples or under 6 mm of path are discarded with a toast; an interrupted (`pointercancel`) stroke is dropped without ending the trial. **Undo** removes the last accepted edge.
4. When the 11th edge is accepted the trial submits by itself: the true swung box appears in dashed blue over the raw strokes, with one 0–100 score and a rotation readout. The same physical face is shaded light blue so it can be followed through the turn (fainter if the swing turned it away from the viewer). Face visibility is worked out from the stored target in `boxShading` (`src/core/box.ts`), so old records shade the same way; strokes and scoring are unaffected.

Boxes have a longest edge of 30–55 mm and other edges 0.4–1.0 of that. The reference pose is a random 3D rotation; one pinhole camera at `CAMERA_DISTANCE_FACTOR` (4×) the box's space diagonal, aimed at the reference centre, projects both boxes, so parallel edges typically converge about 7–9°. Generation is seeded and rejects candidates where any projected edge is under 10 mm, the hinge is more than 50° out of the picture plane, two projected axis directions are within 12°, the arrow would be under 12 mm, or either box (with arrow and label) does not fit its half. The correction-rejection toggle does not apply to boxes. Boxes are never part of the mixed modes.

### Taper drill (pressure width)

One straight stroke per trial along a 60–110 mm line. The cue is three dots at the start, middle and end: each is filled at the true wanted stroke width, inside a faint ring so even a 0.5 mm dot can be found. The stroke is drawn live at its pressure-driven width; on lift, the ideal tapered outline appears in dashed blue. There are four profiles, chosen at random: even, thin to thick, thick to thin, and thin–thick–thin. Thin ends are 0.5–1 mm, thick parts 2–3 mm and even strokes 0.8–2.6 mm; the width changes linearly from start to middle to end, so every taper spans at least a third of the line. Tapers are never part of the mixed modes.

Width comes from Pencil pressure through one generic near-linear curve: 0.5 mm at pressure 0.03 rising linearly to 3 mm at pressure 0.5, clamped (`PRESSURE_LOW`, `PRESSURE_HIGH`, `WIDTH_MIN_MM`, `WIDTH_MAX_MM` in `src/core/taper.ts`). Safari reports placeholder pressures on the first and last sample (about 0.08 on touch-down and 0 on lift), so those two samples are drawn with their neighbour's width and left out of the width score; their positions still count.

## Exercise cues

- **Lines:** two endpoints
- **Arcs:** start, midpoint/apex, and end
- **Circles:** four perimeter checkpoints
- **Ellipses:** four major/minor-axis checkpoints
- **S curves:** start, two opposing shoulders, and end
- **Tapers:** three filled dots at the wanted width (start, middle, end), each in a faint locator ring
- **Boxes:** a reference box with an orange hinge edge, swing arrow and angle; the drawing half shows only the hinge

All targets vary in physical size, orientation, and position while remaining inside the calibrated drawing area. Circles are 18–58 mm across, ellipse major axes are 24–64 mm, and S curves are 30–70 mm long; each range is weighted toward its practical middle rather than page-filling extremes. Either drawing direction is accepted. Circles and ellipses are single-loop exercises in this version.

## Practice modes

The mode selector provides **Today** (the daily queue, below), seven single-exercise modes (five primitives, Tapers and Boxes), and:

- **Mixed — Blocked:** lines, arcs, circles, and ellipses appear as randomized blocks of ten. Each 40-trial cycle contains exactly one block of every included type.
- **Mixed — Random:** each randomized four-trial bag contains one line, arc, circle, and ellipse.

S curves, Tapers and Boxes remain available as dedicated practice modes but are excluded from both mixed modes.

Neither scheduler repeats the same type at a cycle boundary. Execution failures count as attempts; skips and cancelled pointers do not. The selected mode persists, while a reload begins a fresh seeded sequence.

## Today (daily queue)

**Today** is a finishable set of reps each day, like clearing a flashcard deck. Settings → Today's queue holds a standing tick per mode (Lines, Circles, Ellipses and Boxes by default, about 11 minutes); there is no daily decision. Each practice day's queue is built from the ticks the first time it is needed that day, so changes made in the evening apply tomorrow. The one exception: if today's queue was built with nothing ticked, ticking a mode builds it at once.

- Fixed reps per ticked mode, about 2 minutes of each quick shape and about 5 minutes of boxes: Lines 40, Arcs 30, Circles 24, Ellipses 24, S curves 20, Tapers 24, Boxes 10 (`DAILY_COUNTS` in `src/core/dailyQueue.ts`; provisional, to be checked against real pace).
- Reps are served shuffled across modes (seeded by the day, using the scheduler's shuffle). Every saved attempt counts, scored or not; skipping with New and interrupted strokes do not.
- The status line reads e.g. `Today · 12 left · about 4 min` (estimated from rough seconds per rep). At zero a "Done for today" card shows the reps and today's practice time; every other mode stays available for free practice, which never counts toward the queue.
- The page opens on Today while today's queue has reps left; otherwise it opens on the last mode.
- Days roll over at 4 am local time, the same day key as the practice timer. The rollover is checked whenever a trial starts and when the page becomes visible (unless a stroke or a box is in progress). Unfinished reps are dropped: there is no backlog.
- The day's state (day key, the shuffled reps and how many are done) is kept in the settings store, so leaving Today for a free mode and coming back resumes it, as does a reload. Trials served by the queue are saved with practice mode `TODAY`.

## Trophies

The **Trophies** sheet shows one card per exercise with the highest-scoring attempt: score, date, and a redrawn thumbnail of the raw strokes over the dashed blue ideal (for boxes, the reference box and arrow too; tapers are drawn at their pressure width inside the ideal outline). Tap a card to see it larger with its measurements. Unscored attempts never count, ties go to the earliest attempt, and mixed-mode trials count for their exercise. Trials store their calibration id but not its scale, so a circle, ellipse, arc or S-curve trophy drawn under an older calibration is redrawn at the current scale.

## Input capture

- Apple Pencil is accepted as `pointerType === "pen"`; mouse input is accepted for desktop development.
- Finger input on the drawing surface is ignored.
- Safari coalesced Pointer Events are read when available.
- Overlapping Safari event windows are deduplicated by exact coordinate and timestamp identity.
- Raw samples retain coordinates, timestamp, pressure, tilt, twist, contact size, and source event type.
- The displayed stroke is an unmodified piecewise-linear path with no smoothing or beautification.
- The high-DPI canvas keeps CSS pixels as its canonical coordinate system.

## Scoring

Line scoring remains `line-1`. Every additional primitive has an independent first-version metric and scoring identifier.

- Lines use endpoint and orthogonal deviation, efficiency, and turning.
- Arcs use path/endpoint error, angular coverage, overshoot, and curvature consistency.
- Circles use radial error, closure, angular coverage, and curvature consistency.
- Ellipses use dense path distance, canonical phase coverage, closure, and reverse coverage.
- S curves use dense path distance, endpoints, progression, backtracking, and curvature transitions.
- Boxes (`box-1` / `box-1`) work in mm. The 11 strokes are matched one-to-one to the 11 non-hinge edges by minimum total cost (bitmask DP), so drawing order and direction do not matter; cost is the RMS distance of the resampled stroke to the edge's infinite line plus 0.6 × the mean endpoint error. Errors are pooled as `rms = sqrt(mean(rms_i²))` and `endpoint = sqrt(mean(endpoint_i²))`, then `normalizedError = hypot(rms, 0.6 · endpoint) / scale`, where `scale` is the mean true projected length of those edges, and `accuracy = round(100 · exp(-(normalizedError / 0.15)^1.35))`. The 0.15 (`BOX_SCORE_SIGMA`) is provisional. The rotation readout searches swings about the same hinge from −90° to +90° (2° grid, then golden-section refinement, re-matching at every candidate) for the one that best explains the strokes; the card reads e.g. “You turned it 36° · target 45° · edges 2.1 mm”, or says it swung the wrong way.

- Tapers (`taper-1` / `taper-1`) score only the width match. Each sample (except the first and last) is projected onto the target line to find its position along it, and its drawn width is compared with the wanted width there, so either drawing direction is valid even for asymmetric profiles. The line is cut into 20 equal slices; the error is the RMS over occupied slices of each slice's mean squared width error, so a slow stretch with many samples does not count extra. `normalizedError = widthRms / 2.5 mm` and `accuracy = round(100 · exp(-(normalizedError / 0.2)^1.35))`; the 0.2 (`TAPER_SCORE_SIGMA`) is provisional. The path is a gate only: the line's usual gate (including correction rejection when on), plus pressure must be reported, the width samples must cover at least 80% of the slices, and the stroke's RMS distance from the line must be at most 4 mm. The card reads e.g. “Width error 0.4 mm · start/mid/end 0.8/1.9/2.6 vs 0.7/1.7/2.7 mm · path 1.2 mm”.

The execution gate always runs before accuracy. Correction rejection is a persistent device-local toggle and defaults off; incomplete coverage and implausible strokes are still withheld when it is off. Historical scores are never recomputed or overwritten.

## Local development

```sh
npm install
npm run dev
```

## Testing on the iPad

`npm run dev` serves the app over Wi-Fi on port 5173 (plain http). Safari keeps some features for secure pages, notably the share sheet that Save to Photos uses, so `npm run dev:https` serves it on port 5174 with a self-signed certificate (`@vitejs/plugin-basic-ssl`); Safari warns once, then allows it. The two addresses keep separate local data.

## Tests and production build

```sh
npm test
npm run build
```

The build writes the deployable page, assets, manifest, service worker, and diagnostics route into this directory. GitHub Pages serves it at:

```text
https://johnbraybrooke.com/circle-trainer/
```

## Copy mode

The mode picker's **Copy** entry is a scoreless mode for copying from a book (PDF) or a picture (a photo of a page, a screenshot, a scan). It has no target, score, trial record or trophy, does not count toward Today, and lives in `src/copy/`, outside the trial machinery; `main.ts` only shows and hides it and passes in px-per-mm, the drawing hand, the practice clock and toasts. Drawing time counts toward practice time, shown in the status line because the stats bar is hidden in Copy to give the frames more height.

- **Two panes, one frame size.** The reference and drawing panes each hold a frame of identical size, side by side in both orientations, with the drawing pane on the drawing hand's side (left-handed: drawing left, reference right). Stacking them in portrait made both frames far smaller. Copy's controls sit in the panes, not the main toolbar: the drawing pane has Undo, Clear, Compare and Save; the reference pane has the page number, Back to frame, New copy and Books….
- **Reference (finger only).** One finger drags, two fingers pinch-zoom; the Pencil does nothing there. With a mouse, drag and wheel stand in. Outside the frame the reference is dimmed. Safari's page pinch-zoom is blocked over the two panes only, so a page that does get zoomed can be pinched back out over the toolbar; double-tap zoom is off app-wide (`touch-action: manipulation`).
- **PDFs.** Pages are stacked in one strip at a common width: drag through them with a finger (or scroll on a Mac; ⌘ or pinch to zoom). The page number (e.g. `p. 12 / 268`) jumps to a page when tapped. PDF.js is loaded only when a PDF is opened and reads the stored file lazily (see the PDF test page below). While moving, each visible page shows a quick 900 px bitmap (four kept); 150 ms after the view settles, what the pane shows is rendered sharply at device resolution, so any zoom is sharp and every canvas stays near pane size. Renders run one at a time, quick bitmaps first, and sharp ones are cancelled when the view moves again. The last three pages stay loaded so their decoded images are reused. Page sizes are measured once and stored with the book, so later opens are quick.
- **Library.** **Books…** lists stored PDFs and pictures with size, pages and last-opened date, adds new ones, and removes them (removing the open one also removes its copy). Each book remembers where you were in it. On the first add the app asks Safari to keep its storage (`navigator.storage.persist()`) and the sheet says whether it will; adding the app to the Home Screen helps.
- **Drawing (Pencil only).** Fingers do nothing, so a resting palm is ignored. Lines take their width from pressure in a pencil-like 0.4–1.6 mm range (`COPY_WIDTH_RANGE` in `src/core/strokeRender.ts`, shared with Tapers' renderer). Undo removes the last stroke, Clear removes all of them; there is no eraser.
- **Framing locks at the first stroke.** That framing is what Compare uses. Moving the reference afterwards dashes the frame and shows **Back to frame**. When no strokes are left (Clear, or undoing the last one) the framing is released, so the reference can be reframed; **New copy** does the same. The frame's shape follows the screen until the first stroke and is fixed after it; on rotation the largest frame of that shape is fitted, and strokes (stored as fractions of the frame width) and the framing (stored in page units) keep their registration.
- **Compare** shows *Mine*, *Both* or *Reference* in the drawing frame. Tapping the frame with the Pencil flips between Mine and Reference (blink). Both puts the reference under your lines, with an opacity slider and **Blue**, which tints its dark lines blue and makes paper clear. You cannot draw while comparing; **Draw** returns to drawing, and you can compare again later.
- **Autosave.** The copy in progress is saved after every change and reopens after a reload (Copy reopens if it was the last mode). Books and pictures are stored in a separate IndexedDB database, `circle-trainer-library`: each file in store `files`, its details (name, size, pages, where you were) in store `books`, and the copy in store `copy`. Details are saved often, so they must never rewrite the file: Safari stores a rewritten Blob as a new file and deletes the old one, which breaks a PDF being read from it. Database version 1 kept the file in the book record; version 2 moves it out when first opened. The library keeps one connection open. If reading a PDF still fails, Copy reopens the book under the same copy; a page that takes over 20 s to draw is skipped so the rest still draw, so practice data and its schema are untouched. Neither is in the JSON export, and Delete all practice data leaves them.
- **Save to Photos.** Makes a PNG about 2,000 px on the long side, re-drawn from the stored strokes on white: your drawing alone, or side by side with the reference (on the same sides as in the app). On the iPad it opens the share sheet, where **Save Image** puts it in Photos. Sharing files needs a secure (https) page, so where it is unavailable (the dev server over Wi-Fi, desktop browsers) the picture is shown instead: press and hold it and choose **Save to Photos**, or download it. The app keeps no copy of the image.

## PDF test page (Copy mode, stage 0)

`pdf-test/` is a bare feasibility page for Copy mode's PDF support (stage 2), reached by its URL; its **← Circle Trainer** link returns to the drills. It stores a PDF in its own IndexedDB database (`circle-trainer-library`, separate from practice data), reopens it after a reload and draws pages with PDF.js, showing import, open and per-page times, page count, how much of the file has been read, and any error. A notice appears if the previous visit ended while it was busy, which usually means Safari reloaded the tab for lack of memory.

PDF.js (`pdfjs-dist`, pinned) is loaded only on demand, using its legacy build because PDF.js lists Safari only there. The file is read lazily: PDF.js asks for byte ranges and each is answered with `blob.slice(begin, end).arrayBuffer()`, with auto-fetch and streaming off. Its worker is `assets/pdf.worker.min.mjs`; its image decoders (JPEG 2000, JBIG2), colour profile and standard fonts are copied from `node_modules/pdfjs-dist` into `pdfjs/` by a small plugin in `vite.config.ts` (and served from there by the dev server). Every built file keeps a stable, unhashed name; the main page still loads `assets/app.js` and `assets/app.css`.

## Practice time

The last cell of the bottom bar shows the current session and today's total, e.g. `12:34 · 41 min today`, for logging by hand (for example in Toggl). Time is counted from timestamps, never from timer ticks (`src/core/timer.ts`): it accrues only while the page is visible and a stroke started or ended within the last minute (`IDLE_MS`), so reading feedback between strokes counts but walking away does not. A break of 15 minutes or more (`SESSION_BREAK_MS`) starts a new session. Days roll over at 4 am local time (`DAY_ROLLOVER_HOUR`), and time across the rollover is split between the two days. Per-day totals are kept in the settings store (`practice-time-by-day`), saved after every stroke, every 10 seconds while time is accruing, and when the page is hidden, and included in JSON exports as `practiceTimeByDay`. There is no network or Toggl integration. Delete all data removes strokes and trials but keeps the time totals.

## Toolbar and Settings

The toolbar holds only what is used while practising: the mode picker, New, Undo and Tips (Box only), Trophies and Settings. Everything set once lives in the **Settings** sheet: drawing hand, the reject-corrected-strokes option, ruler calibration, and buttons that open Diagnostics and Practice data (export or delete). Diagnostics also opens directly from `?diagnostics` or `#diagnostics`.

## Drawing hand

The **Settings** sheet has a Drawing hand setting (Left by default, stored in the settings store). In landscape, Box puts the drawing half on the drawing hand's side and the reference on the other, so the hand and arm never cover the reference: left-handed means drawing on the left, reference on the right. In portrait the reference is on top for either hand. The feedback card and scale note sit on the side away from the drawing hand; Box tips open over the drawing half so the reference stays visible while reading them. Changing the hand re-lays out a box that has not been started; a box in progress keeps its layout. Saved Box targets store their own positions, so old records and scores are unaffected.

## Physical calibration

The ruler section of the Settings sheet maps CSS pixels to physical millimetres. The user adjusts a horizontal line against a physical ruler until it measures exactly 100 mm. CSS absolute `mm` units are not trusted.

## Storage and compatibility

IndexedDB stores calibration, settings, raw strokes, and trial records. Export schema 2 adds the selected practice mode, target union, and schedule context. Export schema 3 adds Box trials: their `exerciseType` is `BOX`, the target stores the box parameters (edge lengths, reference quaternion, hinge edge index, signed swing, camera factor, both 2D offsets) and the projected corners of both boxes, and the record holds `rawStrokes` (the 11 accepted strokes in drawing order) instead of a single `rawStroke`. Box metrics store per-edge errors and angle errors, pooled values, the fitted and target swings, total duration and path length. Each stroke is also saved to the strokes store. The IndexedDB version is unchanged. Taper trials use the single-stroke record with `exerciseType` `TAPER` and a `TAPER` target (both endpoints, length, profile and the three wanted widths); export stays schema 3.

Existing 0.2 line trials are normalized in memory as `LINE` trials. Their raw data, `line-1` scores, and stored records are not rewritten.

## Manual iPad checklist

1. Confirm the existing calibration and historical line best are preserved.
2. Draw each primitive in both directions and at varied orientations.
3. Confirm only hollow checkpoints are visible before Pencil lift.
4. Confirm the raw black stroke stays visible and the ideal blue path appears afterward.
5. Deliberately make partial and backtracked strokes; verify that accuracy is withheld.
6. Complete at least 40 Mixed — Blocked trials and verify ten-trial block transitions without S curves.
7. Complete at least 20 Mixed — Random trials and verify balanced four-item bags without S curves.
8. Rotate or background the app, resume, and confirm drawing remains stable.
9. Confirm finger movement does not draw or scroll the canvas.
10. Export JSON and inspect the saved target, mode, schedule, metrics, and raw samples.
11. In Boxes, check the arrow and angle label are legible, draw a full box, use Undo, and cancel a stroke mid-way; confirm the score and rotation readout feel fair.
12. In Settings, switch the drawing hand: in landscape Box the reference moves to the side away from that hand, and the feedback card and Tips follow it.
13. Confirm the toolbar fits on one row in both iPad orientations, including Box mode with Undo and Tips.
14. In Tapers, draw each profile in both directions with the Pencil: the stroke widens with pressure as you draw, the dots read as the wanted widths, and the score and start/mid/end widths feel fair. Note how hard you have to press for the thickest widths.
15. Draw for a few minutes, pause for over a minute, switch apps and come back, then reload: the session and today's time stop shortly after you stop drawing, ignore time in the background, and today's total survives the reload.
16. Open the app: it starts on Today with `N left · about M min`. Do a few reps, switch to a free mode and back, and reload: the count resumes. Change the ticks in Settings and confirm the toast says they apply tomorrow. Finish a queue (or tick a single mode) and check the Done card.

## Privacy

There are no accounts, analytics, network APIs, or cloud sync. Raw Pencil trajectories stay in the browser unless the user explicitly exports or deletes them.
