# Circle Trainer

Circle Trainer is a small, local-first Apple Pencil motor-practice tool for iPad Safari. It trains large, committed drawing movements without showing a path that can be traced.

The app is self-contained under `/circle-trainer/`. It does not share code with the main website, add analytics, create accounts, or upload Pencil data.

## Current exercise

The first scored exercise is straight-line practice:

1. Two randomized endpoints appear.
2. The user draws one committed Pencil stroke between them. The target path is not visible while drawing.
3. On `pointerup`, the raw stroke freezes and the ideal line appears.
4. A deliberately loose execution gate checks for obvious crawling, backtracking, or an incomplete movement.
5. Committed strokes receive a 0–100 accuracy score. Rejected strokes receive no geometric score.
6. The target, raw samples, metrics, gate result, and score are stored locally.

Circle and ellipse exercises come after the line metrics have been checked against real iPad strokes.

## Input capture

- Apple Pencil is accepted as `pointerType === "pen"`; mouse input is also accepted for desktop development.
- Finger input on the drawing surface is ignored.
- Safari coalesced Pointer Events are read when available.
- Overlapping coalesced-event windows are deduplicated by exact coordinate and timestamp identity.
- Raw samples retain CSS coordinates, timestamp, pressure, tilt, twist, contact size, and source event type.
- The displayed stroke is an unmodified piecewise-linear path. There is no smoothing, prediction, simplification, or beautification.
- The high-DPI canvas uses CSS pixels as its canonical coordinate system.

## Line metrics

The current metric version records:

- start and end error
- RMS and maximum orthogonal deviation
- path length and path efficiency
- total spatial turning
- duration and mean speed
- normalized geometric error

The execution gate runs before accuracy scoring. Thresholds are intentionally generous and centralized in `src/core/lineMetrics.ts`; they should be tuned only after inspecting real strokes.

## Local development

```sh
npm install
npm run dev
```

Vite serves the source from `src/`.

## Tests and production build

```sh
npm test
npm run build
```

The build writes the deployable page, fixed-name assets, manifest, service worker, and diagnostics route into this directory. Committing those generated files publishes the app through the repository's existing GitHub Pages setup:

```text
https://johnbraybrooke.com/circle-trainer/
```

The unlinked tools index is:

```text
https://johnbraybrooke.com/tools/
```

## Physical calibration

The ruler screen maps CSS pixels to physical millimetres. The user adjusts a horizontal line against a physical ruler until it measures exactly 100 mm. The resulting `cssPxPerMm` value is stored with viewport and device information and referenced by each trial.

CSS absolute `mm` units are not trusted as physical measurements.

## Diagnostics

The Diagnostics panel reports:

- browser and viewport information
- Pointer Events and coalesced-event support
- unique sample count and approximate sample rate
- overlapping samples removed
- timestamp batches repaired
- pressure and tilt availability
- physical calibration
- the last line's RMS error
- saved stroke and trial counts

It is also available at `/circle-trainer/diagnostics/`.

## Storage and export

IndexedDB contains separate stores for settings, calibrations, raw input strokes, and scored trials. An export contains:

```json
{
  "schemaVersion": "1",
  "appVersion": "0.2.0",
  "exportedAt": 1786413600000,
  "calibration": {},
  "device": {},
  "strokes": [],
  "trials": [
    {
      "id": "…",
      "appVersion": "0.2.0",
      "metricVersion": "line-1",
      "scoringVersion": "line-1",
      "createdAtEpochMs": 1786413600000,
      "target": {
        "kind": "LINE",
        "aCss": { "x": 140, "y": 180 },
        "bCss": { "x": 670, "y": 590 },
        "lengthMm": 128.4
      },
      "rawStroke": { "samples": [] },
      "calibrationId": "…",
      "derived": {
        "metrics": {},
        "executionPassed": true,
        "accuracyScore": 87
      }
    }
  ]
}
```

Pre-0.2 input-test strokes remain untouched in the `strokes` store. Their overlapping Safari samples are preserved as originally captured rather than silently rewriting historical data.

## Manual iPad checklist

1. Open the app in both a Safari tab and Home Screen mode.
2. Confirm the existing 100 mm calibration is still present.
3. Draw lines in both directions and at varied angles.
4. Confirm only endpoints are visible until the Pencil lifts.
5. Confirm the raw black stroke stays visible and the ideal blue line appears afterward.
6. Deliberately crawl through one line and make another with obvious backtracking; verify that accuracy is withheld.
7. Draw several fast but imperfect lines; verify they pass the execution gate and receive appropriately lower scores.
8. Confirm finger movement does not draw or scroll the canvas.
9. Open Diagnostics and confirm the unique sample rate is near the previously observed 240 Hz.
10. Export JSON and inspect the saved targets, raw samples, metrics, and scores.

## Safari/iPad limitations

- Input behavior varies by iPad, Pencil, Safari version, load, orientation, and Home Screen mode.
- `pointerrawupdate` is not assumed.
- Browser scheduling can create event gaps, so raw event gaps are not treated as human pauses.
- Pencil hover is model-dependent and unused.
- Safari or iPadOS may remove browser storage; important sessions should be exported.
- The app cannot prevent iPadOS system edge gestures.

## Privacy

There are no accounts, analytics, network APIs, or cloud sync. Raw Pencil trajectories stay in the browser unless the user explicitly exports or deletes them.
