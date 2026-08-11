import "./styles.css";

import type {
  DeviceSnapshot,
  ExportBundle,
  PhysicalCalibration,
  RawSample,
  RawStroke,
  StrokeEventType,
} from "./core/types";
import { clearStrokes, getCalibration, getStrokes, saveCalibration, saveStroke } from "./storage";

const APP_VERSION = "0.1.0";
const SCHEMA_VERSION = "1" as const;
const DEFAULT_RULER_WIDTH_CSS_PX = 378;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const canvas = requiredElement<HTMLCanvasElement>("#drawingCanvas");
const context = (() => {
  const value = canvas.getContext("2d", { alpha: true });
  if (!value) throw new Error("Canvas 2D is unavailable in this browser");
  return value;
})();

const statusText = requiredElement<HTMLElement>("#statusText");
const emptyState = requiredElement<HTMLElement>("#emptyState");
const scaleStatus = requiredElement<HTMLElement>("#scaleStatus");
const strokeCount = requiredElement<HTMLElement>("#strokeCount");
const sampleCount = requiredElement<HTMLElement>("#sampleCount");
const sampleRate = requiredElement<HTMLElement>("#sampleRate");
const pointerType = requiredElement<HTMLElement>("#pointerType");
const toast = requiredElement<HTMLElement>("#toast");

const calibrationDialog = requiredElement<HTMLDialogElement>("#calibrationDialog");
const rulerLine = requiredElement<HTMLElement>("#rulerLine");
const rulerSlider = requiredElement<HTMLInputElement>("#rulerSlider");
const rulerOutput = requiredElement<HTMLOutputElement>("#rulerOutput");

const diagnosticsDialog = requiredElement<HTMLDialogElement>("#diagnosticsDialog");
const diagnosticGrid = requiredElement<HTMLElement>("#diagnosticGrid");
const dataDialog = requiredElement<HTMLDialogElement>("#dataDialog");
const dataSummary = requiredElement<HTMLElement>("#dataSummary");

interface RuntimeDiagnostics {
  pointerEventCount: number;
  rawSampleCount: number;
  exactDuplicateCount: number;
  ignoredTouchCount: number;
  pressureObserved: boolean;
  tiltObserved: boolean;
  lastStroke: RawStroke | null;
}

const runtime: RuntimeDiagnostics = {
  pointerEventCount: 0,
  rawSampleCount: 0,
  exactDuplicateCount: 0,
  ignoredTouchCount: 0,
  pressureObserved: false,
  tiltObserved: false,
  lastStroke: null,
};

let calibration: PhysicalCalibration | null = null;
let activePointerId: number | null = null;
let activeStroke: RawStroke | null = null;
let displayedStrokes: RawStroke[] = [];
let savedStrokeCount = 0;
let toastTimer: number | undefined;
let touchNoticeShown = false;

function createId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getDeviceSnapshot(): DeviceSnapshot {
  const supportsCoalesced = "PointerEvent" in window
    && typeof PointerEvent.prototype.getCoalescedEvents === "function";
  return {
    userAgent: navigator.userAgent,
    viewportWidthCssPx: window.innerWidth,
    viewportHeightCssPx: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    pointerEvents: "PointerEvent" in window,
    coalescedEvents: supportsCoalesced,
  };
}

function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2200);
}

function setStatus(message: string): void {
  statusText.textContent = message;
}

function configureContext(): void {
  context.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 2.2;
  context.strokeStyle = "#171817";
  context.fillStyle = "#171817";
}

function resizeCanvas(): void {
  const bounds = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(bounds.width * dpr));
  canvas.height = Math.max(1, Math.round(bounds.height * dpr));
  configureContext();
  redrawAll();
  configureRuler();
}

function drawDot(sample: RawSample): void {
  context.beginPath();
  context.arc(sample.xCss, sample.yCss, context.lineWidth / 2, 0, Math.PI * 2);
  context.fill();
}

function drawSegment(start: RawSample, end: RawSample): void {
  context.beginPath();
  context.moveTo(start.xCss, start.yCss);
  context.lineTo(end.xCss, end.yCss);
  context.stroke();
}

function drawStroke(stroke: RawStroke): void {
  if (stroke.samples.length === 0) return;
  drawDot(stroke.samples[0]);
  for (let index = 1; index < stroke.samples.length; index += 1) {
    drawSegment(stroke.samples[index - 1], stroke.samples[index]);
  }
}

function redrawAll(): void {
  const bounds = canvas.getBoundingClientRect();
  context.clearRect(0, 0, bounds.width, bounds.height);
  displayedStrokes.forEach(drawStroke);
  if (activeStroke) drawStroke(activeStroke);
}

function sourceEvents(event: PointerEvent): PointerEvent[] {
  if (typeof event.getCoalescedEvents !== "function") return [event];
  const coalesced = event.getCoalescedEvents();
  return coalesced.length > 0 ? coalesced : [event];
}

function eventToSample(event: PointerEvent, sourceEventType: StrokeEventType): RawSample {
  const bounds = canvas.getBoundingClientRect();
  return {
    xCss: event.clientX - bounds.left,
    yCss: event.clientY - bounds.top,
    tMs: event.timeStamp,
    pressure: Number.isFinite(event.pressure) ? event.pressure : undefined,
    tiltX: Number.isFinite(event.tiltX) ? event.tiltX : undefined,
    tiltY: Number.isFinite(event.tiltY) ? event.tiltY : undefined,
    twist: Number.isFinite(event.twist) ? event.twist : undefined,
    tangentialPressure: Number.isFinite(event.tangentialPressure) ? event.tangentialPressure : undefined,
    width: Number.isFinite(event.width) ? event.width : undefined,
    height: Number.isFinite(event.height) ? event.height : undefined,
    sourceEventType,
  };
}

function appendPointerSamples(event: PointerEvent, sourceEventType: StrokeEventType): void {
  if (!activeStroke) return;
  runtime.pointerEventCount += 1;

  for (const sourceEvent of sourceEvents(event)) {
    const sample = eventToSample(sourceEvent, sourceEventType);
    const previous = activeStroke.samples.at(-1);
    if (previous
      && previous.xCss === sample.xCss
      && previous.yCss === sample.yCss
      && previous.tMs === sample.tMs) {
      runtime.exactDuplicateCount += 1;
      continue;
    }

    activeStroke.samples.push(sample);
    runtime.rawSampleCount += 1;
    runtime.pressureObserved ||= (sample.pressure ?? 0) > 0;
    runtime.tiltObserved ||= (sample.tiltX ?? 0) !== 0 || (sample.tiltY ?? 0) !== 0;

    if (previous) drawSegment(previous, sample);
    else drawDot(sample);
  }
}

function acceptsDrawingPointer(event: PointerEvent): boolean {
  return event.pointerType === "pen" || event.pointerType === "mouse";
}

function handlePointerDown(event: PointerEvent): void {
  if (!acceptsDrawingPointer(event)) {
    runtime.ignoredTouchCount += 1;
    if (!touchNoticeShown) {
      showToast("Finger drawing is off — use Apple Pencil");
      touchNoticeShown = true;
    }
    return;
  }
  if (activePointerId !== null) return;

  event.preventDefault();
  activePointerId = event.pointerId;
  activeStroke = {
    id: createId(),
    pointerType: event.pointerType,
    startedAtEpochMs: Date.now(),
    cancelled: false,
    samples: [],
  };
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Capture can fail if the pointer ended between dispatch and this handler.
  }

  emptyState.classList.add("hidden");
  pointerType.textContent = event.pointerType === "pen" ? "Pencil" : "Mouse";
  setStatus("Capturing raw stroke");
  appendPointerSamples(event, "pointerdown");
}

function handlePointerMove(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) return;
  event.preventDefault();
  appendPointerSamples(event, "pointermove");
}

async function finishStroke(event: PointerEvent, cancelled: boolean): Promise<void> {
  if (event.pointerId !== activePointerId || !activeStroke) return;
  event.preventDefault();
  if (!cancelled) appendPointerSamples(event, "pointerup");

  const completed = activeStroke;
  completed.cancelled = cancelled;
  completed.completedAtEpochMs = Date.now();
  runtime.lastStroke = completed;
  displayedStrokes.push(completed);
  activeStroke = null;
  activePointerId = null;

  updateLastStrokeHud(completed);
  setStatus(cancelled ? "Stroke interrupted — ready again" : "Raw stroke saved — ready again");

  try {
    await saveStroke(completed);
    savedStrokeCount += 1;
    strokeCount.textContent = savedStrokeCount.toLocaleString();
  } catch {
    showToast("This stroke could not be saved locally");
  }
}

function updateLastStrokeHud(stroke: RawStroke): void {
  const samples = stroke.samples;
  sampleCount.textContent = samples.length.toLocaleString();
  pointerType.textContent = stroke.pointerType === "pen" ? "Pencil" : stroke.pointerType;
  if (samples.length < 2) {
    sampleRate.textContent = "—";
    return;
  }
  const duration = samples.at(-1)!.tMs - samples[0].tMs;
  sampleRate.textContent = duration > 0
    ? `${Math.round(((samples.length - 1) * 1000) / duration)} Hz`
    : "—";
}

function clearCanvas(): void {
  displayedStrokes = [];
  activeStroke = null;
  activePointerId = null;
  emptyState.classList.remove("hidden");
  configureContext();
  redrawAll();
  setStatus("Canvas cleared — saved data kept");
}

function configureRuler(): void {
  const maximum = Math.max(240, Math.min(760, window.innerWidth - 100));
  rulerSlider.max = String(maximum);
  const desired = calibration ? calibration.cssPxPerMm * 100 : Number(rulerSlider.value) || DEFAULT_RULER_WIDTH_CSS_PX;
  rulerSlider.value = String(Math.min(maximum, Math.max(Number(rulerSlider.min), Math.round(desired))));
  updateRulerDisplay();
}

function updateRulerDisplay(): void {
  const width = Number(rulerSlider.value);
  rulerLine.style.width = `${width}px`;
  rulerOutput.value = `${Math.round(width)} px`;
}

async function persistCalibration(): Promise<void> {
  calibration = {
    id: createId(),
    cssPxPerMm: Number(rulerSlider.value) / 100,
    calibratedAt: Date.now(),
    viewportWidthCssPx: window.innerWidth,
    viewportHeightCssPx: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
  try {
    await saveCalibration(calibration);
    updateScaleStatus();
    calibrationDialog.close();
    showToast("100 mm calibration saved");
  } catch {
    showToast("Calibration could not be saved");
  }
}

function updateScaleStatus(): void {
  if (!calibration) {
    scaleStatus.textContent = "Scale not calibrated";
    return;
  }
  scaleStatus.textContent = `Calibrated · ${calibration.cssPxPerMm.toFixed(2)} px/mm`;
}

function timestampHistogram(stroke: RawStroke | null): string {
  if (!stroke || stroke.samples.length < 2) return "No stroke captured";
  const buckets = [0, 0, 0, 0, 0];
  for (let index = 1; index < stroke.samples.length; index += 1) {
    const delta = stroke.samples[index].tMs - stroke.samples[index - 1].tMs;
    if (delta < 4) buckets[0] += 1;
    else if (delta < 8) buckets[1] += 1;
    else if (delta < 16) buckets[2] += 1;
    else if (delta < 33) buckets[3] += 1;
    else buckets[4] += 1;
  }
  return `<4:${buckets[0]} · <8:${buckets[1]} · <16:${buckets[2]} · <33:${buckets[3]} · 33+:${buckets[4]}`;
}

function buildDiagnosticReport(): Record<string, string | number | boolean> {
  const device = getDeviceSnapshot();
  const last = runtime.lastStroke;
  const duration = last && last.samples.length > 1
    ? last.samples.at(-1)!.tMs - last.samples[0].tMs
    : 0;
  const rate = duration > 0 && last
    ? Math.round(((last.samples.length - 1) * 1000) / duration)
    : 0;

  return {
    "App version": APP_VERSION,
    "User agent": device.userAgent,
    "Viewport (CSS px)": `${device.viewportWidthCssPx} × ${device.viewportHeightCssPx}`,
    "Device pixel ratio": device.devicePixelRatio,
    "Pointer Events": device.pointerEvents,
    "Coalesced events API": device.coalescedEvents,
    "Pressure observed": runtime.pressureObserved,
    "Tilt observed": runtime.tiltObserved,
    "Active pointer": activeStroke?.pointerType ?? last?.pointerType ?? "None",
    "Last stroke samples": last?.samples.length ?? 0,
    "Last raw sample rate": rate ? `${rate} Hz` : "No stroke captured",
    "Last stroke duration": duration ? `${Math.round(duration)} ms` : "No stroke captured",
    "Timestamp delta histogram (ms)": timestampHistogram(last),
    "Exact duplicate samples skipped": runtime.exactDuplicateCount,
    "Finger touches ignored": runtime.ignoredTouchCount,
    "Calibration": calibration ? `${calibration.cssPxPerMm.toFixed(4)} CSS px/mm` : "Not calibrated",
    "Saved strokes": savedStrokeCount,
  };
}

function renderDiagnostics(): void {
  diagnosticGrid.replaceChildren();
  for (const [label, value] of Object.entries(buildDiagnosticReport())) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = String(value);
    diagnosticGrid.append(term, description);
  }
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function exportAllData(): Promise<void> {
  try {
    const bundle: ExportBundle = {
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt: Date.now(),
      calibration,
      device: getDeviceSnapshot(),
      strokes: await getStrokes(),
    };
    downloadJson(`circle-trainer-${dateStamp()}.json`, bundle);
    showToast("JSON export created");
  } catch {
    showToast("Data export failed");
  }
}

async function showDataDialog(): Promise<void> {
  try {
    const strokes = await getStrokes();
    savedStrokeCount = strokes.length;
    const samples = strokes.reduce((total, stroke) => total + stroke.samples.length, 0);
    dataSummary.textContent = strokes.length === 0
      ? "No strokes saved yet."
      : `${strokes.length.toLocaleString()} strokes and ${samples.toLocaleString()} raw samples are saved in this browser.`;
  } catch {
    dataSummary.textContent = "Saved data could not be read in this browser.";
  }
  dataDialog.showModal();
}

async function deleteAllData(): Promise<void> {
  const confirmed = window.confirm("Delete every saved stroke from this browser? This cannot be undone.");
  if (!confirmed) return;
  try {
    await clearStrokes();
    savedStrokeCount = 0;
    strokeCount.textContent = "0";
    displayedStrokes = [];
    redrawAll();
    emptyState.classList.remove("hidden");
    dataSummary.textContent = "No strokes saved yet.";
    dataDialog.close();
    showToast("All stroke data deleted");
  } catch {
    showToast("Saved data could not be deleted");
  }
}

async function copyDiagnostics(): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(buildDiagnosticReport(), null, 2));
    showToast("Diagnostics copied");
  } catch {
    showToast("Clipboard access was unavailable");
  }
}

function wireControls(): void {
  requiredElement<HTMLButtonElement>("#clearCanvasButton").addEventListener("click", clearCanvas);
  requiredElement<HTMLButtonElement>("#calibrateButton").addEventListener("click", () => {
    configureRuler();
    calibrationDialog.showModal();
  });
  requiredElement<HTMLButtonElement>("#diagnosticsButton").addEventListener("click", () => {
    renderDiagnostics();
    diagnosticsDialog.showModal();
  });
  requiredElement<HTMLButtonElement>("#dataButton").addEventListener("click", () => void showDataDialog());
  requiredElement<HTMLButtonElement>("#saveCalibrationButton").addEventListener("click", () => void persistCalibration());
  requiredElement<HTMLButtonElement>("#resetCalibrationButton").addEventListener("click", () => {
    rulerSlider.value = String(Math.min(Number(rulerSlider.max), DEFAULT_RULER_WIDTH_CSS_PX));
    updateRulerDisplay();
  });
  requiredElement<HTMLButtonElement>("#copyDiagnosticsButton").addEventListener("click", () => void copyDiagnostics());
  requiredElement<HTMLButtonElement>("#exportDiagnosticsButton").addEventListener("click", () => {
    downloadJson(`circle-trainer-diagnostics-${dateStamp()}.json`, buildDiagnosticReport());
  });
  requiredElement<HTMLButtonElement>("#exportDataButton").addEventListener("click", () => void exportAllData());
  requiredElement<HTMLButtonElement>("#deleteDataButton").addEventListener("click", () => void deleteAllData());
  rulerSlider.addEventListener("input", updateRulerDisplay);

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", (event) => void finishStroke(event, false));
  canvas.addEventListener("pointercancel", (event) => void finishStroke(event, true));
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("resize", resizeCanvas);
}

async function initialize(): Promise<void> {
  wireControls();
  resizeCanvas();
  try {
    [calibration, savedStrokeCount] = await Promise.all([
      getCalibration(),
      getStrokes().then((strokes) => strokes.length),
    ]);
  } catch {
    showToast("Local storage is unavailable; drawing still works");
  }
  updateScaleStatus();
  strokeCount.textContent = savedStrokeCount.toLocaleString();
  configureRuler();

  if (new URLSearchParams(window.location.search).has("diagnostics") || window.location.hash === "#diagnostics") {
    renderDiagnostics();
    diagnosticsDialog.showModal();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("./service-worker.js").catch(() => undefined);
    });
  }
}

void initialize();
