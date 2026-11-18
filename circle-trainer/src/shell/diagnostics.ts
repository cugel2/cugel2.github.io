import { EXERCISE_LABELS, versionsForExercise } from "../activities/drills";
import { MODE_LABELS } from "../core/scheduler";
import { dateStamp, downloadJson } from "./data";
import { activities, app, APP_VERSION, getDeviceSnapshot, requiredElement, showToast } from "./state";
import { calibrationDialog } from "./settings";

/** The Diagnostics sheet (moved from main.ts in 0.17.0); the drill runner supplies its own lines. */

export const diagnosticsDialog = requiredElement<HTMLDialogElement>("#diagnosticsDialog");
const diagnosticGrid = requiredElement<HTMLElement>("#diagnosticGrid");

function buildDiagnosticReport(): Record<string, string | number | boolean> {
  const device = getDeviceSnapshot();
  const drills = activities.drills.diagnostics();
  return {
    "App version": APP_VERSION,
    "Current mode": MODE_LABELS[app.selectedMode],
    "Current exercise": EXERCISE_LABELS[drills.currentExercise],
    "Correction gate": app.correctionGateEnabled ? "On" : "Off",
    "Metric version": versionsForExercise(drills.currentExercise).metric,
    "User agent": device.userAgent,
    "Viewport (CSS px)": `${device.viewportWidthCssPx} × ${device.viewportHeightCssPx}`,
    "Device pixel ratio": device.devicePixelRatio,
    "Pointer Events": device.pointerEvents,
    "Coalesced events API": device.coalescedEvents,
    "Pressure observed": drills.pressureObserved,
    "Tilt observed": drills.tiltObserved,
    "Last unique samples": drills.lastUniqueSamples,
    "Last unique sample rate": drills.lastUniqueSampleRate,
    "Timestamp delta histogram (ms)": drills.timestampHistogram,
    "Overlapping samples removed": drills.overlappingSamplesRemoved,
    "Out-of-order batches repaired": drills.outOfOrderBatchesRepaired,
    "Finger touches ignored": drills.fingerTouchesIgnored,
    "Drawing hand": app.handedness === "LEFT" ? "Left" : "Right",
    "Drawing canvas (CSS px)": drills.canvasCss,
    "Drawing canvas (pixels)": drills.canvasPixels,
    "Canvas size watcher fixes": drills.canvasWatcherFixes,
    "Window inner height": window.innerHeight,
    "Visual viewport": window.visualViewport ? `${Math.round(window.visualViewport.height)} high, offset ${Math.round(window.visualViewport.offsetTop)}` : "Not available",
    "--app-height": document.documentElement.style.getPropertyValue("--app-height") || "Not set",
    "Calibration": app.calibration ? `${app.calibration.cssPxPerMm.toFixed(4)} CSS px/mm` : "Not calibrated",
    "Last normalized error": drills.lastNormalizedError,
    "Saved input strokes": app.savedStrokeCount,
    "Saved trials": app.savedTrialCount,
    "Offline helper": serviceWorkerState(),
  };
}

/** Whether the service worker (offline use, fresh releases) is running for this page. */
function serviceWorkerState(): string {
  if (!("serviceWorker" in navigator)) return window.isSecureContext ? "Not supported" : "Not available on this address (needs https)";
  const controller = navigator.serviceWorker.controller;
  return controller ? "Running" : "Not running yet (it starts from the next open)";
}

export function renderDiagnostics(): void {
  diagnosticGrid.replaceChildren();
  for (const [label, value] of Object.entries(buildDiagnosticReport())) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = String(value);
    diagnosticGrid.append(term, description);
  }
}

async function copyDiagnostics(): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(buildDiagnosticReport(), null, 2));
    showToast("Diagnostics copied");
  } catch { showToast("Clipboard access was unavailable"); }
}

export function wireDiagnostics(): void {
  // Diagnostics and practice data open from Settings, replacing it rather than stacking on top.
  requiredElement<HTMLButtonElement>("#diagnosticsButton").addEventListener("click", () => { calibrationDialog.close(); renderDiagnostics(); diagnosticsDialog.showModal(); });
  requiredElement<HTMLButtonElement>("#copyDiagnosticsButton").addEventListener("click", () => void copyDiagnostics());
  requiredElement<HTMLButtonElement>("#exportDiagnosticsButton").addEventListener("click", () => downloadJson(`circle-trainer-diagnostics-${dateStamp()}.json`, buildDiagnosticReport()));
}
