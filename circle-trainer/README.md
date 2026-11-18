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
7. While the feedback shows, a Pencil tap anywhere on the drawing canvas starts the next rep, as does the **Next** button. A tap lasts at most 350 ms and strays at most 2 mm (calibrated) from where it touched down (`isTap` in `src/core/tap.ts`). Nothing is drawn or recorded during feedback: a longer touch is ignored with a "Not counted" toast, so it is never scored against the next target. Taps on the feedback card, the Tips panel or any button do not count. In Box mode this applies once the 11th edge has been scored; between edges the Pencil draws as usual. A finger tap also counts during feedback only (nothing is drawn then); a long finger touch is ignored silently, and a second contact landing during the touch (a palm, a pinch) cancels it. Fingers still never draw.

### Box drill (hinge swing)

1. The reference half shows a complete reference box — all 12 edges — in thin grey. The edges a solid box would hide are drawn fainter, and the visible face with the largest projected area is shaded in light see-through grey, so the wireframe reads one way only. One edge, the hinge, is thick orange. A curved orange arrow (dot to arrowhead) shows which way the box swings about the hinge, with the angle (30°, 45° or 60°). It follows the far edge's path just outside the box, from 20° before the current position to 20° into the swing, so it shows direction without giving away the answer.
2. The drawing half shows only the hinge, as the identical 2D segment translated. It sits at the same place relative to its half as in the reference, so its position gives nothing away.
3. The user draws the other 11 edges of the swung box from imagination, one stroke each, in any order. The status line shows progress (`Box · 4/11`). Strokes with fewer than 8 samples or under 6 mm of path are discarded with a toast; an interrupted (`pointercancel`) stroke is dropped without ending the trial. **Undo** removes the last accepted edge.
4. When the 11th edge is accepted the trial submits by itself: the true swung box appears in dashed blue over the raw strokes, with one 0–100 score and a rotation readout. The same physical face is shaded light blue so it can be followed through the turn (fainter if the swing turned it away from the viewer). Face visibility is worked out from the stored target in `boxShading` (`src/core/box.ts`), so old records shade the same way; strokes and scoring are unaffected.

Since 0.13.3 every box is a cube with 30–55 mm edges (`SHORTER_EDGE_RATIO_RANGE` is 1–1), so the drill trains rotation alone; varied proportions are to come back in stages (0.7–1.0, then the original 0.4–1.0 used until 0.13.2) once cube scores hold up. Saved targets keep their own dimensions. The reference pose is a random 3D rotation; one pinhole camera at `CAMERA_DISTANCE_FACTOR` (4×) the box's space diagonal, aimed at the reference centre, projects both boxes, so parallel edges typically converge about 7–9°. Generation is seeded and rejects candidates where any projected edge is under 10 mm, the hinge is more than 50° out of the picture plane, two projected axis directions are within 12°, the arrow would be under 12 mm, or either box (with arrow and label) does not fit its half. The correction-rejection toggle does not apply to boxes. Boxes are never part of the mixed modes.

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

The toolbar's mode switch has two buttons, **Today** (the daily queue, below) and **Copy**, and a **Drills** menu beside them with the seven single-exercise modes (five primitives, Tapers and Boxes). The menu reads "Drills" while Today or Copy is on and shows the drill's name while one is.

Two mixed modes left the menu in 0.15.0, since Today interleaves the drills; their code and records stay, and a stored Mixed mode opens on Today:

- **Mixed — Blocked:** lines, arcs, circles, and ellipses appear as randomized blocks of ten. Each 40-trial cycle contains exactly one block of every included type.
- **Mixed — Random:** each randomized four-trial bag contains one line, arc, circle, and ellipse.

Neither scheduler repeats the same type at a cycle boundary. Execution failures count as attempts; skips and cancelled pointers do not. The selected mode persists, while a reload begins a fresh seeded sequence.

## Today (daily queue)

**Today** is a finishable set of reps each day, like clearing a flashcard deck. Settings → Today's queue holds a standing tick per mode (Lines, Circles, Ellipses and Boxes by default, about 11 minutes); there is no daily decision. Each practice day's queue is built from the ticks the first time it is needed that day. Changing the ticks changes today's queue at once (since 0.18.1; `retickQueue`): before the first rep it is built afresh; after that the reps already done stay done and keep counting, and the rest is rebuilt from the new ticks less what has been done of each drill (a drill unticked loses its remaining reps, one ticked adds its count). A rep in progress, such as a half-drawn box, is kept, so the change applies from the next one. Once the day is finished (drills done and Copy time used up, declined with Finish for today, or Off: the same test as the seven-day dots), changes apply from tomorrow, so ticking for tomorrow in the evening cannot reopen a finished day. Unticking everything is not finishing: ticking drills again adds them back.

- Fixed reps per ticked mode, about 2 minutes of each quick shape and about 5 minutes of boxes: Lines 40, Arcs 30, Circles 24, Ellipses 24, S curves 20, Tapers 24, Boxes 10 (`DAILY_COUNTS` in `src/core/dailyQueue.ts`; provisional, to be checked against real pace).
- Reps are served interleaved across modes (`interleave` in `src/core/dailyQueue.ts`, seeded by the day): in random order, but the same mode never comes twice in a row when the counts allow it, so nearly every rep means switching movement (interleaved practice; the contextual interference effect). When one mode outnumbers all the others together (40 lines with only 10 boxes, say), it repeats only as often as it must (40 lines against 34 other reps gives 5 pairs), at random points, never more in a row than needed. A queue already started keeps its order. Every saved attempt counts, scored or not; skipping with New and interrupted strokes do not.
- In Today the bottom bar shows a thin progress bar of the day's reps and `12 left` (`All done` at zero) in place of Reps, Streak, Last and Best, which are per-session and mix modes; the time stays (`queueProgress` in `src/core/dailyQueue.ts`). Free-practice modes keep the usual bar.
- The status line reads e.g. `Today · 12 left · about 4 min` (estimated from rough seconds per rep). At zero the card hands over to Copy while Copy time is left (see Daily flow, below), and otherwise says "Done for today" with the reps and today's practice time; every other mode stays available for free practice, which never counts toward the queue.
- The page opens on Today while today's queue has reps left; otherwise it opens on the last mode. A free mode picked from the menu earlier the same practice day is kept across a reload (Safari dropping the tab, say), so free practice is not thrown back to Today (`startupMode` in `src/core/dailyFlow.ts`; the day is kept in `localStorage` as `circle-trainer:mode-day`). A new day opens on Today. Copy reopens after a reload only on the same practice day, so a new day starts on Today.
- Days roll over at 4 am local time, the same day key as the practice timer. The rollover is checked whenever a trial starts and when the page becomes visible (unless a stroke or a box is in progress). Unfinished reps are dropped: there is no backlog.
- The day's state (day key, the shuffled reps and how many are done) is kept in the settings store, so leaving Today for a free mode and coming back resumes it, as does a reload. Trials served by the queue are saved with practice mode `TODAY`.

## Daily flow (drills, then Copy)

Since 0.18.0 Today is planned from what the activities offer (`src/core/todayPlan.ts`): each activity's `todayParts` gives REPS parts (Drills: each ticked drill at its Today count and pace) or TIMED parts (Copy: its minutes when not Off). `TODAY_OFFERS` in `src/shell/today.ts` lists the activities in the order of the day. All REPS parts are interleaved into one queue as before; TIMED parts follow in order. A new drill joins Today through the registry alone; a new activity joins by offering its parts there and adding its setting. The flow below still has one timed part, Copy, with its own clock; several timed parts in a row (a clock, handoff card and skip for each) are left for the "one daily total" design. The stored queue, ticks, Copy time and day marks keep their stored form, and tests check that the plan gives exactly the queue, estimate and Copy time of 0.17.0.

The day runs like clearing a flashcard deck: open the app, do Today's drills as the warm-up, then a timed stretch of Copy, and the app says you are done. There is no start button and no "flow in progress" state: everything is worked out from the day's drill queue, the day's active Copy time and two per-day marks, all under the same 4 am day key, so reloads and mode switches cannot break it. The rules are pure functions in `src/core/dailyFlow.ts`.

- **Copy time per day** (Settings, under Today's queue): Off, 15, 30, 45 or 60 minutes, default 30 (`copy-budget-minutes` in the settings store). A fixed number, not tied to drill time.
- **Copy time** is a second practice clock (`copy-time-by-day`, also in JSON exports as `copyTimeByDay`) with the same rules as the practice timer, running only while Copy is open and the page visible. Any Copy time that day counts, from the card or the Copy button, before or after the drills. Pencil strokes and finger moves and pinches of the reference both count as activity, for Copy time and for the practice timer. Drill time is today's practice time less Copy time.
- **Handoff.** When Today's queue reaches zero and Copy time is left, its card reads `Drills done · 9 min` with **Start copy · 30 min** (the Copy time still left today) and a small **Finish for today**. Start copy opens Copy as it was left: the same book and place, or the copy in progress. Finish for today, a used-up Copy budget, or Copy set to Off show the "Done for today" card instead.
- **Countdown.** While Copy time is left, Copy's status line ends `12:40 left`. At zero nothing interrupts: it reads `Time's up · finish this one`. The next tap on Compare (turning it on), New copy, or closing the Save sheet shows a card once that day: **Done for today · 41 min** (the day's total time) with **Keep going**; or, if the drills are not finished, **Copy time's up** with the reps left, **Go to Today** and **Keep going**. After that Copy works as usual and the status line shows time copied, e.g. `34 min copied`. With Copy Off, Copy shows the practice timer as before.
- **Last seven days.** The Done for today cards (Today's and Copy's) show a row of seven dots, oldest first and ending today, each with its weekday letter: filled for a day whose flow was finished, hollow otherwise. No streak count. A day counts as finished once the drills are done and Copy time is used up, set to Off, or declined with Finish for today (a day with nothing ticked and Copy Off never counts). The check runs every second and when a Done card shows, and the finished days are kept in the settings store (`finished-days`, newest 120) and in JSON exports as `finishedDays` (`dayFinished`, `lastSevenDays` in `src/core/dailyFlow.ts`). History starts with 0.14.1: earlier days show hollow.
- **Backup reminder.** Practice data lives only in this browser, so the same Done for today cards say **Last export N days ago · Export now** once the last JSON export is more than 7 practice days old, or **Practice data not exported yet** after 3 days with any practice time and no export (`backupReminder` in `src/core/backup.ts`). Export now makes the usual JSON export. The time of each export is kept in the settings store (`last-export`); the reminder never blocks anything and is not shown otherwise.
- **Per-day marks** (`daily-flow-marks`): the handoff was declined, and Copy's card has been shown. Marks from another day are ignored, so at 4 am everything starts again; a copy in progress is kept.

## Trophies

The **Trophies** sheet shows one card per exercise with the highest-scoring attempt: score, date, and a redrawn thumbnail of the raw strokes over the dashed blue ideal (for boxes, the reference box and arrow too; tapers are drawn at their pressure width inside the ideal outline). Tap a card to see it larger with its measurements. Unscored attempts never count, ties go to the earliest attempt, and mixed-mode trials count for their exercise. Trials store their calibration id but not its scale, so a circle, ellipse, arc or S-curve trophy drawn under an older calibration is redrawn at the current scale.

## Input capture

- Apple Pencil is accepted as `pointerType === "pen"`; mouse input is accepted for desktop development.
- Finger input on the drawing surface never draws; during feedback a finger tap starts the next rep.
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
- Boxes (metric `box-1`, scoring `box-2` since 0.13.1) work in mm. The 11 strokes are matched one-to-one to the 11 non-hinge edges by minimum total cost (bitmask DP), so drawing order and direction do not matter; cost is the RMS distance of the resampled stroke to the edge's infinite line plus 0.6 × the mean endpoint error. Errors are pooled as `rms = sqrt(mean(rms_i²))` and `endpoint = sqrt(mean(endpoint_i²))`, then `normalizedError = hypot(rms, 0.6 · endpoint) / scale`, where `scale` is the mean true projected length of those edges, and `accuracy = round(100 · exp(-(normalizedError / 0.4)^1.35))` (`boxScoreFromError`; `BOX_SCORE_SIGMA` = 0.4). The 0.4 was set from 20 real Pencil boxes: a perfectly drawn box turned 10°, 20° or 30° wrong scores about 76, 49 or 29. Scoring `box-1` (0.4.0–0.13.0) used 0.15, which gave rough boxes 0–12; those stored scores are kept as they are. The rotation readout searches swings about the same hinge from −90° to +90° (2° grid, then golden-section refinement, re-matching at every candidate) for the one that best explains the strokes; the card reads e.g. “You turned it 36° · target 45° · edges 2.1 mm”, or says it swung the wrong way.

- Tapers (`taper-1` / `taper-1`) score only the width match. Each sample (except the first and last) is projected onto the target line to find its position along it, and its drawn width is compared with the wanted width there, so either drawing direction is valid even for asymmetric profiles. The line is cut into 20 equal slices; the error is the RMS over occupied slices of each slice's mean squared width error, so a slow stretch with many samples does not count extra. `normalizedError = widthRms / 2.5 mm` and `accuracy = round(100 · exp(-(normalizedError / 0.2)^1.35))`; the 0.2 (`TAPER_SCORE_SIGMA`) is provisional. The path is a gate only: the line's usual gate (including correction rejection when on), plus pressure must be reported, the width samples must cover at least 80% of the slices, and the stroke's RMS distance from the line must be at most 4 mm. The card reads e.g. “Width error 0.4 mm · start/mid/end 0.8/1.9/2.6 vs 0.7/1.7/2.7 mm · path 1.2 mm”.

The execution gate always runs before accuracy. Correction rejection is a persistent device-local toggle and defaults off; incomplete coverage and implausible strokes are still withheld when it is off. Historical scores are never recomputed or overwritten.

## Code layout

Since 0.17.0 the app is a shell with two activities. `src/main.ts` only mounts them and starts up. `src/shell/` holds everything shared: `state.ts` (shared state, toast, status line), `today.ts` (Today's queue, the daily flow and its cards, practice time), `modes.ts` (the mode switch, entering and leaving Copy), `settings.ts`, `data.ts` (export, trimming, delete, Trophies), `diagnostics.ts`, `appHeight.ts` and `trophyView.ts`. `src/activities/types.ts` is the Activity contract: each activity is mounted once with a host (what the shell lends it: px per mm, drawing hand, toast, status line, the practice clock; Drills also get the calibration, the correction setting and Today's queue; Copy gets the end-of-time checkpoint) and is shown and hidden by the shell. `src/activities/drills/runner.ts` is the trial state machine (Pencil capture, feedback, tap-for-next, canvas size); `src/activities/copy/index.ts` is a thin adapter around `src/copy/`, which is unchanged. Activities never import the shell, and the shell imports an activity only through its `index.ts`.

Each drill is a self-contained unit in `src/activities/drills/` (since 0.16.0): `primitives/` (lines, arcs, circles, ellipses, S curves), `taper/` and `box/`, each implementing the `Drill` contract in `types.ts`, listed once in `registry.ts`. A drill supplies its names and wording, versions, Today count and seconds per rep, how many strokes it needs, its Undo and Tips buttons, target generation, analysis, canvas drawing, feedback and trophy text and the trophy drawing; Box also rejects too-short edges (`acceptStroke`) and re-lays itself out after a rotation (`relayout`). The trial state machine in `src/main.ts` names no drill: it reaches everything through the registry, and treats every drill needing several strokes the same way (progress, Undo, a record with `rawStrokes`). `EXERCISE_LABELS`, `DAILY_COUNTS`, `SECONDS_PER_REP`, `ALL_EXERCISE_TYPES` and `versionsForExercise` are views over the registry with unchanged values. Scoring stays in `src/core/` unchanged. `tests/drills/` checks every drill's drawing, feedback and trophy text and trophy drawing call for call against a verbatim copy of the 0.15.4 code.

Adding a drill: add its id to `ExerciseType` in `src/core/types.ts`, add its folder, and add it to `DRILLS` in `registry.ts` (and an `<option>` in the Drills menu in `src/index.html`).

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

`tests/golden/` pins today's behaviour so code can be reorganised without changing it: generated targets for every drill (fixed seeds, landscape, portrait and the small-canvas fallback, both hands for boxes), the full analysis of synthetic strokes for every drill (clean, reversed, rough, offset, partial, backtracked; tapers with matched, even, missing and off-line pressure; boxes turned right, too far, half-way and the wrong way), the per-drill labels, versions and daily counts, every practice mode's schedule (including the retired Mixed modes), Today's queue order and the daily flow's cards for fixed days and ticks, and `normalizeStoredTrial` over a synthetic set of stored records. The pinned values live in `tests/golden/data/*.json` and are compared to the last digit; a missing file fails rather than being recorded. All app imports go through `tests/golden/api.ts`, so moving a function means changing one import there and never a pinned value. The files are written only on purpose, with `UPDATE_GOLDEN=1 npx vitest run tests/golden`. The strokes are synthetic; real practice exports are never used.

The build writes the deployable page, assets, manifest, service worker, and diagnostics route into this directory. The service worker fetches every file from the network first, asking the server each time (`cache: "no-cache"`) rather than trusting GitHub Pages' 10-minute freshness, so a release reaches the Home Screen app on its next full open (since 0.18.2 it registers even when startup finishes after the page's load event, which before could leave a visit without it; Diagnostics shows "Offline helper: Running"); an unchanged file costs only a short "not modified" reply, and offline the cached copy is used. GitHub Pages serves it at:

```text
https://johnbraybrooke.com/circle-trainer/
```

## Copy mode

The mode switch's **Copy** button is a scoreless mode for copying from a book (PDF) or a picture (a photo of a page, a screenshot, a scan). It has no target, score, trial record or trophy, does not count toward Today, and lives in `src/copy/`, outside the trial machinery; `main.ts` only shows and hides it and passes in px-per-mm, the drawing hand, the practice clock and toasts. Drawing time counts toward practice time, shown in the status line because the stats bar is hidden in Copy to give the frames more height.

- **Two panes, one frame size.** The reference and drawing panes each hold a frame of identical size, side by side in both orientations, with the drawing pane on the drawing hand's side (left-handed: drawing left, reference right). Stacking them in portrait made both frames far smaller. Copy's controls sit in the panes, not the main toolbar: the drawing pane has Undo, Clear, Compare and Save (while comparing, Undo and Clear give way to the compare controls; Compare, which becomes Draw, and Save stay where they are); the reference pane has the page number, the Memory setting, New copy and Books…, plus a small bar at its foot for Back to frame and the memory controls.
- **Reference (finger only).** One finger drags, two fingers pinch-zoom; the Pencil does nothing there. With a mouse, drag and wheel stand in. Outside the frame the reference is dimmed. Safari's page pinch-zoom is blocked over the two panes only, so a page that does get zoomed can be pinched back out over the toolbar; double-tap zoom is off app-wide (`touch-action: manipulation`).
- **PDFs.** Pages are stacked in one strip at a common width: drag through them with a finger (or scroll on a Mac; ⌘ or pinch to zoom). The page number (e.g. `p. 12 / 268`) jumps to a page when tapped. PDF.js is loaded only when a PDF is opened and reads the stored file lazily (see the PDF test page below). While moving, each visible page shows a quick 900 px bitmap (four kept); 150 ms after the view settles, what the pane shows is rendered sharply at device resolution, so any zoom is sharp and every canvas stays near pane size. Renders run one at a time, quick bitmaps first, and sharp ones are cancelled when the view moves again. The last three pages stay loaded so their decoded images are reused. Page sizes are measured once and stored with the book, so later opens are quick.
- **Library.** **Books…** lists stored PDFs and pictures with size, pages and last-opened date, adds new ones, and removes them (removing the open one also removes its copy). Each book remembers where you were in it. On the first add the app asks Safari to keep its storage (`navigator.storage.persist()`) and the sheet says whether it will; adding the app to the Home Screen helps.
- **Drawing (Pencil only).** Fingers do nothing, so a resting palm is ignored. Lines take their width from pressure in a pencil-like 0.4–1.6 mm range (`COPY_WIDTH_RANGE` in `src/core/strokeRender.ts`, shared with Tapers' renderer). Undo removes the last stroke, Clear removes all of them; there is no eraser.
- **Framing locks at the first stroke.** That framing is what Compare uses. Moving the reference afterwards dashes the frame and shows **Back to frame**. When no strokes are left (Clear, or undoing the last one) the framing is released, so the reference can be reframed; **New copy** does the same. A copy with no strokes fills the panes in whatever orientation the iPad is in, refitting at once on rotation with the reference kept the same size on screen and centred, so you choose portrait or landscape by how you hold it. The first stroke fixes the frame's shape; rotating after that fits the largest frame of that shape, and strokes (stored as fractions of the frame width) and the framing (stored in page units) keep their registration.
- **Draw from memory.** The reference pane's **Memory** setting is Off, 15, 30, 60 or 120 s (kept across copies and books). With it on, frame the reference and tap **Start**: the framing locks, and while the countdown runs you study it; the reference cannot be moved and drawing is refused. When time runs out the reference is covered. **Peek** shows it again for 3 s (`PEEK_MS`) and the number of peeks is shown; Compare reveals it as usual. Changing the setting, Clear, or a New copy starts the exercise over. The rules are pure functions in `src/copy/copySession.ts` (`memoryPhase`, `startMemory`, `peek`).
- **Compare** shows *Mine*, *Both* or *Reference* in the drawing frame. Tapping the frame with the Pencil flips between Mine and Reference (blink). Both puts the reference under your lines, with an opacity slider and **Blue**, which tints its dark lines blue and makes paper clear. You cannot draw while comparing; **Draw** returns to drawing, and you can compare again later.
- **Autosave.** The copy in progress is saved after every change and reopens after a reload (Copy reopens if it was the last mode). Books and pictures are stored in a separate IndexedDB database, `circle-trainer-library`: each file in store `files`, its details (name, size, pages, where you were) in store `books`, and the copy in store `copy`. Details are saved often, so they must never rewrite the file: Safari stores a rewritten Blob as a new file and deletes the old one, which breaks a PDF being read from it. Database version 1 kept the file in the book record; version 2 moves it out when first opened. The library keeps one connection open. If reading a PDF still fails, Copy reopens the book under the same copy; a page that takes over 20 s to draw is skipped so the rest still draw, so practice data and its schema are untouched. Neither is in the JSON export, and Delete all practice data leaves them.
- **Save to Photos.** Makes a PNG about 2,000 px on the long side, re-drawn from the stored strokes on white: **My drawing** alone, **Side by side** with the reference (on the same sides as in the app), or **Overlaid**, your lines over the reference as Compare's Both view shows them (with its blue tint and opacity). The reference is rendered afresh at export size, so a PDF page stays sharp. The choice matching the current view is the prominent button: Overlaid while comparing, My drawing otherwise. On the iPad it opens the share sheet, where **Save Image** puts it in Photos. Sharing files needs a secure (https) page, so where it is unavailable (the dev server over Wi-Fi, desktop browsers) the picture is shown instead: press and hold it and choose **Save to Photos**, or download it. The app keeps no copy of the image.

## PDF test page (Copy mode, stage 0)

`pdf-test/` is a bare feasibility page for Copy mode's PDF support (stage 2), reached by its URL; its **← Circle Trainer** link returns to the drills. It stores a PDF in its own IndexedDB database (`circle-trainer-library`, separate from practice data), reopens it after a reload and draws pages with PDF.js, showing import, open and per-page times, page count, how much of the file has been read, and any error. A notice appears if the previous visit ended while it was busy, which usually means Safari reloaded the tab for lack of memory.

PDF.js (`pdfjs-dist`, pinned) is loaded only on demand, using its legacy build because PDF.js lists Safari only there. The file is read lazily: PDF.js asks for byte ranges and each is answered with `blob.slice(begin, end).arrayBuffer()`, with auto-fetch and streaming off. Its worker is `assets/pdf.worker.min.mjs`; its image decoders (JPEG 2000, JBIG2), colour profile and standard fonts are copied from `node_modules/pdfjs-dist` into `pdfjs/` by a small plugin in `vite.config.ts` (and served from there by the dev server). Every built file keeps a stable, unhashed name; the main page still loads `assets/app.js` and `assets/app.css`.

## Practice time

The last cell of the bottom bar shows the current session and today's total, e.g. `12:34 · 41 min today`, for logging by hand (for example in Toggl). Time is counted from timestamps, never from timer ticks (`src/core/timer.ts`): it accrues only while the page is visible and a stroke started or ended within the last minute (`IDLE_MS`), so reading feedback between strokes counts but walking away does not. A break of 15 minutes or more (`SESSION_BREAK_MS`) starts a new session. Days roll over at 4 am local time (`DAY_ROLLOVER_HOUR`), and time across the rollover is split between the two days. Per-day totals are kept in the settings store (`practice-time-by-day`), saved after every stroke, every 10 seconds while time is accruing, and when the page is hidden, and included in JSON exports as `practiceTimeByDay`. There is no network or Toggl integration. Delete all data removes strokes and trials but keeps the time totals.

## Home Screen app height

In the Home Screen app, iPadOS can keep the portrait height after rotating to landscape, so a layout sized with `height: 100%` runs off the screen. The app shell's height is therefore set from the window (`--app-height`, the smaller of `innerHeight` and the visual viewport's height) on resize, orientation change and page size changes, rechecked shortly after each and once a second as a backstop.

That late correction changes the drawing canvas's size without a window resize. Until 0.15.2 the canvas kept its old pixel size then, so the browser stretched the picture and Pencil marks landed away from the tip, by more toward the bottom of the screen. The canvas is now also watched with a ResizeObserver: whenever its pixel size no longer matches its on-screen box it is resized and redrawn (`backingOutOfDate` in `src/core/canvasSize.ts`). Diagnostics shows the canvas's CSS and pixel sizes (marked "pixels out of date" if they disagree), how often the watcher fixed them, the window's and visual viewport's heights and `--app-height`.

On any resize, rotation included, the canvas's pixels follow its size at once, but the target is judged only once the size has stayed still for 350 ms (`RESIZE_SETTLE_MS`), because on the iPad a rotation arrives in steps, the height last (`actionAfterResize` in `src/core/canvasSize.ts`). A stroke being drawn is never disturbed; the decision waits until it is done. Other drills keep their target while it fits and get a new one only if it no longer fits and nothing is drawn yet; the feedback card is kept. A box is placed for the exact canvas it was made on (its halves side by side in landscape, stacked in portrait), so after a resize the same box (same pose, hinge and swing) is moved into the new halves (`relayoutBox`). Edges already drawn move with the drawing half by exactly the same amount, so they keep their place on the box and score exactly the same; the saved record holds them where they were when the box was finished. Each box is only made to fit the halves of the screen it was made on, and the portrait halves are smaller: on iPad sizes about a third to a half of landscape boxes fit portrait (most portrait boxes fit landscape). When the box does not fit, an unstarted box is replaced with a new one; a box with edges drawn keeps its old layout with a toast to turn the iPad back, which lines it all up again. The box divider is drawn for the canvas the box is laid out for.

## Toolbar and Settings

The toolbar holds only what is used while practising: the mode switch (Today, Copy, Drills), New, Undo and Tips (Box only), Trophies and Settings. Everything set once lives in the **Settings** sheet: drawing hand, the reject-corrected-strokes option, ruler calibration, and buttons that open Diagnostics and Practice data (export or delete). Diagnostics also opens directly from `?diagnostics` or `#diagnostics`.

## Drawing hand

The **Settings** sheet has a Drawing hand setting (Left by default, stored in the settings store). In landscape, Box puts the drawing half on the drawing hand's side and the reference on the other, so the hand and arm never cover the reference: left-handed means drawing on the left, reference on the right. In portrait the reference is on top for either hand. The feedback card and scale note sit on the side away from the drawing hand; Box tips open over the drawing half so the reference stays visible while reading them. Changing the hand re-lays out a box that has not been started; a box in progress keeps its layout. Saved Box targets store their own positions, so old records and scores are unaffected.

## Physical calibration

The ruler section of the Settings sheet maps CSS pixels to physical millimetres. The user adjusts a horizontal line against a physical ruler until it measures exactly 100 mm. CSS absolute `mm` units are not trusted.

## Storage and compatibility

IndexedDB stores calibration, settings, raw strokes, and trial records. Export schema 2 adds the selected practice mode, target union, and schedule context. Export schema 3 adds Box trials: their `exerciseType` is `BOX`, the target stores the box parameters (edge lengths, reference quaternion, hinge edge index, signed swing, camera factor, both 2D offsets) and the projected corners of both boxes, and the record holds `rawStrokes` (the 11 accepted strokes in drawing order) instead of a single `rawStroke`. Box metrics store per-edge errors and angle errors, pooled values, the fitted and target swings, total duration and path length. Each stroke is also saved to the strokes store. The IndexedDB version is unchanged. Taper trials use the single-stroke record with `exerciseType` `TAPER` and a `TAPER` target (both endpoints, length, profile and the three wanted widths); export stays schema 3.

### What is kept (0.15.3+)

Every trial record is kept for good: target, metrics, score, versions and schedule. Raw Pencil points are most of the data (about 735 bytes each in a schema 3 export), so they are kept for 30 days (`RAW_SAMPLE_DAYS` in `src/core/retention.ts`), and for good for every trial that is or has ever been a trophy (the best scored attempt at its exercise when it was drawn; ties stay with the earlier one, as in the trophy case). An older trial keeps its stroke records (ids, times, pointer type) with an empty `samples` list and is marked `samplesPruned: true`; nothing else in it changes and no score is recomputed. Trimming is one-way, so it happens only right after a JSON export, only if something is past 30 days, and only after a confirmation that the file saved; it then touches only data created before that export. Trials are rewritten in batches of 200, each all-or-nothing, so an interruption leaves the rest for the next export. The Data sheet shows the rule and how much has been trimmed (`retention-pruned` in the settings store).

Each stroke is stored once, inside its trial. Up to 0.15.2 every trial stroke was also written to the `strokes` store; those spare copies are removed at startup (nothing is lost), and the `strokes` store now holds only strokes that belong to no trial (interrupted ones), which are trimmed with the rest after 30 days.

Export schema 4 (0.15.3+) is written without indentation and lists in `strokes` only the strokes that belong to no trial; trials carry their own, and trimmed trials have empty sample lists. Together that makes an export about a quarter of the size: about 194 bytes per Pencil point instead of 735. Older exports (schema 3) are unchanged. The four sample fields that are constant on a first-generation Pencil (twist, tangential pressure, contact width and height) are still recorded as they come.

Existing 0.2 line trials are normalized in memory as `LINE` trials. Their raw data, `line-1` scores, and stored records are not rewritten.

## Manual iPad checklist

1. Confirm the existing calibration and historical line best are preserved.
2. Draw each primitive in both directions and at varied orientations.
3. Confirm only hollow checkpoints are visible before Pencil lift.
4. Confirm the raw black stroke stays visible and the ideal blue path appears afterward.
5. Deliberately make partial and backtracked strokes; verify that accuracy is withheld.
6. (Mixed modes are no longer in the menu; their scheduler tests still run.)
7. Switch between Today, Copy and a drill from the toolbar, and check the pressed button and the Drills menu's label.
8. Rotate or background the app, resume, and confirm drawing remains stable.
9. Confirm finger movement does not draw or scroll the canvas.
10. Export JSON and inspect the saved target, mode, schedule, metrics, and raw samples (schema 4: compact, each stroke once, inside its trial).
11. In Boxes, check the arrow and angle label are legible, draw a full box, use Undo, and cancel a stroke mid-way; confirm the score and rotation readout feel fair.
12. In Settings, switch the drawing hand: in landscape Box the reference moves to the side away from that hand, and the feedback card and Tips follow it.
13. Confirm the toolbar fits on one row in both iPad orientations, including Box mode with Undo and Tips.
14. In Tapers, draw each profile in both directions with the Pencil: the stroke widens with pressure as you draw, the dots read as the wanted widths, and the score and start/mid/end widths feel fair. Note how hard you have to press for the thickest widths.
15. Draw for a few minutes, pause for over a minute, switch apps and come back, then reload: the session and today's time stop shortly after you stop drawing, ignore time in the background, and today's total survives the reload.
16. Open the app: it starts on Today with `N left · about M min`. Do a few reps, switch to a free mode and back, and reload: the count resumes. Before the first rep, change the ticks in Settings: the queue and the current target update at once. After a rep, the toast says changes apply tomorrow. Finish a queue (or tick a single mode) and check the Done card.
17. Daily flow: finish Today's queue and check the handoff card (drill time, Start copy with the minutes left, Finish for today). Start copy returns to the book and copy as left; the status line counts down while you draw and while a finger moves the reference, and pauses after a minute idle or with the app in the background. Set Copy time to 15 to reach zero sooner: the status line says time is up, the next Compare shows the Done card once, and Keep going leaves Copy as usual. Try Copy before the drills too: the card offers Go to Today.
18. After a drill stroke, tap the canvas with the Pencil, then (next rep) with a finger: the next rep starts, with nothing drawn on it. Draw a longer stroke during feedback instead: it is ignored with a toast. Tapping the feedback card (away from Next) or the Tips panel does nothing. Check in Today, a free mode and Box (after the 11th edge).

## Privacy

There are no accounts, analytics, network APIs, or cloud sync. Raw Pencil trajectories stay in the browser unless the user explicitly exports or deletes them.
