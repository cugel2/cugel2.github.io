# Circle Trainer

Circle Trainer is a local-first Apple Pencil motor-practice tool for iPad Safari. It trains large, committed lines, arcs, circles, ellipses, and S curves without showing a path that can be traced.

The app is self-contained under `/circle-trainer/`. It does not add analytics, create accounts, or upload Pencil data.

## Practice loop

1. Small hollow checkpoints specify the movement.
2. The user draws one committed Pencil stroke while the ideal path remains hidden.
3. On `pointerup`, the raw stroke freezes and the ideal path appears in dashed blue.
4. A deliberately loose execution gate rejects incomplete, excessively slow, or obviously corrective movements.
5. Passing strokes receive a versioned 0–100 accuracy score.
6. The target, raw samples, schedule context, metrics, gate result, and score are saved locally.

## Exercise cues

- **Lines:** two endpoints
- **Arcs:** start, midpoint/apex, and end
- **Circles:** four perimeter checkpoints
- **Ellipses:** four major/minor-axis checkpoints
- **S curves:** start, two opposing shoulders, and end

All targets vary in physical size, orientation, and position while remaining inside the calibrated drawing area. Either drawing direction is accepted. Circles and ellipses are single-loop exercises in this version.

## Practice modes

The mode selector provides five single-exercise modes plus:

- **Mixed — Blocked:** all five exercise types appear as randomized blocks of ten. Each 50-trial cycle contains exactly one block of every type.
- **Mixed — Random:** each randomized five-trial bag contains one of every exercise type.

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

The execution gate always runs before accuracy. Historical scores are never recomputed or overwritten.

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

IndexedDB stores calibration, settings, raw strokes, and trial records. Export schema 2 adds the selected practice mode, target union, and schedule context.

Existing 0.2 line trials are normalized in memory as `LINE` trials. Their raw data, `line-1` scores, and stored records are not rewritten.

## Manual iPad checklist

1. Confirm the existing calibration and historical line best are preserved.
2. Draw each primitive in both directions and at varied orientations.
3. Confirm only hollow checkpoints are visible before Pencil lift.
4. Confirm the raw black stroke stays visible and the ideal blue path appears afterward.
5. Deliberately make partial and backtracked strokes; verify that accuracy is withheld.
6. Complete at least 50 Mixed — Blocked trials and verify ten-trial block transitions.
7. Complete at least 25 Mixed — Random trials and verify balanced variation.
8. Rotate or background the app, resume, and confirm drawing remains stable.
9. Confirm finger movement does not draw or scroll the canvas.
10. Export JSON and inspect the saved target, mode, schedule, metrics, and raw samples.

## Privacy

There are no accounts, analytics, network APIs, or cloud sync. Raw Pencil trajectories stay in the browser unless the user explicitly exports or deletes them.
