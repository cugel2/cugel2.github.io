# Circle Trainer

Circle Trainer is a local-first Apple Pencil motor-practice tool for iPad Safari. It trains large, committed lines, arcs, circles, ellipses, and S curves without showing a path that can be traced, plus a Box drill for mental rotation of simple forms.

The app is self-contained under `/circle-trainer/`. It does not add analytics, create accounts, or upload Pencil data.

## Practice loop

1. Small hollow checkpoints specify the movement.
2. The user draws one committed Pencil stroke while the ideal path remains hidden.
3. On `pointerup`, the raw stroke freezes and the ideal path appears in dashed blue.
4. The execution gate rejects incomplete or implausible movements. Optional correction rejection can also reject substantial backtracking; it defaults off.
5. Passing strokes receive a versioned 0–100 accuracy score.
6. The target, raw samples, schedule context, metrics, gate result, and score are saved locally.

### Box drill (hinge swing)

1. The left half (top half in portrait) shows a complete reference box — all 12 edges, hidden ones included — in thin grey. One edge, the hinge, is thick orange. A curved orange arrow (dot to arrowhead) shows which way the box swings about the hinge, with the angle (30°, 45° or 60°). It follows the far edge's path just outside the box, from 20° before the current position to 20° into the swing, so it shows direction without giving away the answer.
2. The right half (bottom half in portrait) shows only the hinge, as the identical 2D segment translated. It sits at the same place relative to its half as in the reference, so its position gives nothing away.
3. The user draws the other 11 edges of the swung box from imagination, one stroke each, in any order. The status line shows progress (`Box · 4/11`). Strokes with fewer than 8 samples or under 6 mm of path are discarded with a toast; an interrupted (`pointercancel`) stroke is dropped without ending the trial. **Undo** removes the last accepted edge.
4. When the 11th edge is accepted the trial submits by itself: the true swung box appears in dashed blue over the raw strokes, with one 0–100 score and a rotation readout.

Boxes have a longest edge of 30–55 mm and other edges 0.4–1.0 of that. The reference pose is a random 3D rotation; one pinhole camera at `CAMERA_DISTANCE_FACTOR` (4×) the box's space diagonal, aimed at the reference centre, projects both boxes, so parallel edges typically converge about 7–9°. Generation is seeded and rejects candidates where any projected edge is under 10 mm, the hinge is more than 50° out of the picture plane, two projected axis directions are within 12°, the arrow would be under 12 mm, or either box (with arrow and label) does not fit its half. The correction-rejection toggle does not apply to boxes. Boxes are never part of the mixed modes.

## Exercise cues

- **Lines:** two endpoints
- **Arcs:** start, midpoint/apex, and end
- **Circles:** four perimeter checkpoints
- **Ellipses:** four major/minor-axis checkpoints
- **S curves:** start, two opposing shoulders, and end
- **Boxes:** a reference box with an orange hinge edge, swing arrow and angle; the drawing half shows only the hinge

All targets vary in physical size, orientation, and position while remaining inside the calibrated drawing area. Circles are 18–58 mm across, ellipse major axes are 24–64 mm, and S curves are 30–70 mm long; each range is weighted toward its practical middle rather than page-filling extremes. Either drawing direction is accepted. Circles and ellipses are single-loop exercises in this version.

## Practice modes

The mode selector provides six single-exercise modes (five primitives and Boxes) plus:

- **Mixed — Blocked:** lines, arcs, circles, and ellipses appear as randomized blocks of ten. Each 40-trial cycle contains exactly one block of every included type.
- **Mixed — Random:** each randomized four-trial bag contains one line, arc, circle, and ellipse.

S curves and Boxes remain available as dedicated practice modes but are excluded from both mixed modes.

Neither scheduler repeats the same type at a cycle boundary. Execution failures count as attempts; skips and cancelled pointers do not. The selected mode persists, while a reload begins a fresh seeded sequence.

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

The execution gate always runs before accuracy. Correction rejection is a persistent device-local toggle and defaults off; incomplete coverage and implausible strokes are still withheld when it is off. Historical scores are never recomputed or overwritten.

## Local development

```sh
npm install
npm run dev
```

## Tests and production build

```sh
npm test
npm run build
```

The build writes the deployable page, assets, manifest, service worker, and diagnostics route into this directory. GitHub Pages serves it at:

```text
https://johnbraybrooke.com/circle-trainer/
```

## Physical calibration

The ruler screen maps CSS pixels to physical millimetres. The user adjusts a horizontal line against a physical ruler until it measures exactly 100 mm. CSS absolute `mm` units are not trusted.

## Storage and compatibility

IndexedDB stores calibration, settings, raw strokes, and trial records. Export schema 2 adds the selected practice mode, target union, and schedule context. Export schema 3 adds Box trials: their `exerciseType` is `BOX`, the target stores the box parameters (edge lengths, reference quaternion, hinge edge index, signed swing, camera factor, both 2D offsets) and the projected corners of both boxes, and the record holds `rawStrokes` (the 11 accepted strokes in drawing order) instead of a single `rawStroke`. Box metrics store per-edge errors and angle errors, pooled values, the fitted and target swings, total duration and path length. Each stroke is also saved to the strokes store. The IndexedDB version is unchanged.

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

## Privacy

There are no accounts, analytics, network APIs, or cloud sync. Raw Pencil trajectories stay in the browser unless the user explicitly exports or deletes them.
