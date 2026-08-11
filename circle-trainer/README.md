# Circle Trainer

Circle Trainer is a small, local-first Apple Pencil input test for iPad Safari. It is the first implementation phase of a geometric motor-practice tool: before adding targets or scores, it verifies that the browser captures Pencil movement faithfully on the actual device.

The deployed app is completely self-contained under `/circle-trainer/`. It does not share code or styles with the main website, does not add navigation to the main site, and does not send data over the network.

## What this version does

- captures `pointerdown`, `pointermove`, `pointerup`, and `pointercancel`
- accepts Apple Pencil (`pointerType === "pen"`) and mouse input for desktop testing
- ignores finger input on the drawing surface
- reads coalesced Pointer Events when Safari supplies them
- draws the captured coordinates as an unmodified piecewise-linear path
- renders the canvas at the device pixel ratio while retaining coordinates in CSS pixels
- calibrates CSS pixels to physical millimetres with a 100 mm ruler line
- reports browser, input, timing, pressure, and tilt diagnostics
- stores completed and cancelled raw strokes in IndexedDB
- exports all saved strokes and device metadata as JSON
- caches the app shell for offline use after the first successful visit

This version deliberately does **not** recognize shapes, smooth lines, reveal targets, or calculate scores. Those features depend on validating Pencil capture on the target iPad first.

## Local development

From this directory:

```sh
npm install
npm run dev
```

Vite serves the source from `src/`. Mouse input is enabled so the capture path can be checked on a desktop browser.

## Tests and production build

```sh
npm test
npm run build
```

The build keeps source files in place and writes the deployable `index.html`, hashed assets, manifest, service worker, and diagnostics route into this directory. Because this repository is served directly by GitHub Pages, committing those generated files makes the app available at:

```text
https://johnbraybrooke.com/circle-trainer/
```

No change to the website homepage or navigation is required.

## Input path

1. A Pencil `pointerdown` claims the pointer and begins a raw stroke.
2. Every source event is expanded with `getCoalescedEvents()` when available.
3. Each sample retains its CSS coordinates, original event timestamp, pressure, tilt, twist, contact size, and source event type.
4. Only exact duplicates with identical coordinates and timestamps are skipped.
5. Each adjacent pair of raw points is drawn directly to Canvas 2D. No smoothing, simplification, prediction, or shape replacement occurs.
6. On `pointerup` or `pointercancel`, the stroke is saved to IndexedDB.

The canvas backing store uses the device pixel ratio for crisp rendering, but raw coordinates remain in CSS pixels. The stored ruler calibration provides `cssPxPerMm` for later physical-scale analysis.

## Runtime capability report

The Diagnostics panel reports:

- browser user agent
- viewport size in CSS pixels
- device pixel ratio
- Pointer Events support
- `getCoalescedEvents()` availability
- pressure and tilt observed during this session
- active or most recent pointer type
- raw sample count and approximate sample rate
- stroke duration and timestamp-delta histogram
- exact duplicate count
- ignored finger-touch count
- physical calibration value
- saved stroke count

The same panel is available directly at `/circle-trainer/diagnostics/`.

## Manual iPad checklist

Test both a normal Safari tab and an app added with **Share → Add to Home Screen**.

1. Open the app in portrait and landscape.
2. Tap **Calibrate**, place a physical ruler against the display, and save an exact 100 mm line.
3. Draw ten large, fast Pencil strokes and ten slower curves.
4. Confirm that the page does not scroll and the visible line stays under the Pencil.
5. Touch and drag the drawing surface with a finger; confirm that it does not draw.
6. Open Diagnostics and record the coalesced-event, sample-rate, pressure, tilt, and timestamp results.
7. Rotate the device and draw again.
8. Background and reopen the app, then confirm the saved-stroke count remains.
9. Add the app to the Home Screen, disconnect from the network after one successful launch, and reopen it.
10. Export the JSON file and inspect or share it before any browser data is cleared.

## Known Safari/iPad limitations

- Browser input sampling and coalesced-event behavior vary by iPad model, Pencil, Safari version, device load, and whether the app is in a tab or Home Screen mode.
- Safari does not guarantee `pointerrawupdate`; this app does not depend on it.
- Event gaps can reflect browser scheduling, so they should not be treated as human pauses without later analysis.
- Pencil hover is model-dependent and is not used.
- Browser storage can be removed by the user or operating system; export important sessions.
- Web haptics and reliable Pencil-specific gesture suppression are not assumed.
- The app cannot prevent iPadOS system edge gestures.

## Export structure

```json
{
  "schemaVersion": "1",
  "appVersion": "0.1.0",
  "exportedAt": 1786377600000,
  "calibration": {
    "id": "…",
    "cssPxPerMm": 4.82,
    "calibratedAt": 1786377600000,
    "viewportWidthCssPx": 1194,
    "viewportHeightCssPx": 834,
    "devicePixelRatio": 2
  },
  "device": {
    "userAgent": "…",
    "viewportWidthCssPx": 1194,
    "viewportHeightCssPx": 834,
    "devicePixelRatio": 2,
    "pointerEvents": true,
    "coalescedEvents": true
  },
  "strokes": [
    {
      "id": "…",
      "pointerType": "pen",
      "startedAtEpochMs": 1786377600000,
      "completedAtEpochMs": 1786377600450,
      "cancelled": false,
      "samples": [
        {
          "xCss": 184.25,
          "yCss": 336.5,
          "tMs": 12345.67,
          "pressure": 0.42,
          "tiltX": -18,
          "tiltY": 27,
          "twist": 0,
          "tangentialPressure": 0,
          "width": 2.1,
          "height": 2.1,
          "sourceEventType": "pointermove"
        }
      ]
    }
  ]
}
```

## Privacy

There are no accounts, analytics, network APIs, or cloud sync. Raw Pencil trajectories remain in the browser's IndexedDB unless the user explicitly exports or deletes them.
