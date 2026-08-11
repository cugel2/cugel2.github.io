import "./styles.css";

import { rawSampleIdentity } from "./core/input";
import { analyseLineStroke, METRIC_VERSION, SCORING_VERSION, type LineAnalysis } from "./core/lineMetrics";
import type {
  DeviceSnapshot,
  ExportBundle,
  LineTarget,
  LineTrialRecord,
  PhysicalCalibration,
  RawSample,
  RawStroke,
  StrokeEventType,
} from "./core/types";
import {
  clearStrokes,
  clearTrials,
  getCalibration,
  getStrokes,
  getTrials,
  saveCalibration,
  saveStroke,
  saveTrial,
} from "./storage";

const APP_VERSION = "0.2.0";
const SCHEMA_VERSION = "1" as const;
const DEFAULT_CSS_PX_PER_MM = 96 / 25.4;
const DEFAULT_RULER_WIDTH_CSS_PX = 378;

type TrialState = "PREPARING" | "READY" | "DRAWING" | "PROCESSING" | "FEEDBACK";

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
const repCount = requiredElement<HTMLElement>("#repCount");
const streakCount = requiredElement<HTMLElement>("#streakCount");
const lastScore = requiredElement<HTMLElement>("#lastScore");
const bestScore = requiredElement<HTMLElement>("#bestScore");
const feedbackCard = requiredElement<HTMLElement>("#feedbackCard");
const feedbackResult = requiredElement<HTMLElement>("#feedbackResult");
const feedbackScore = requiredElement<HTMLElement>("#feedbackScore");
const feedbackDetail = requiredElement<HTMLElement>("#feedbackDetail");
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
  duplicateSampleCount: number;
  reorderedSampleCount: number;
  ignoredTouchCount: number;
  pressureObserved: boolean;
  tiltObserved: boolean;
}

const runtime: RuntimeDiagnostics = {
  pointerEventCount: 0,
  rawSampleCount: 0,
  duplicateSampleCount: 0,
  reorderedSampleCount: 0,
  ignoredTouchCount: 0,
  pressureObserved: false,
  tiltObserved: false,
};

let calibration: PhysicalCalibration | null = null;
let trialState: TrialState = "PREPARING";
let target: LineTarget | null = null;
let activePointerId: number | null = null;
let activeStroke: RawStroke | null = null;
let activeSampleKeys = new Set<string>();
let completedStroke: RawStroke | null = null;
let lastAnalysis: LineAnalysis | null = null;
let sessionReps = 0;
let sessionStreak = 0;
let lifetimeBest: number | null = null;
let savedStrokeCount = 0;
let savedTrialCount = 0;
let toastTimer: number | undefined;
let touchNoticeShown = false;
let hasPractisedBefore = false;

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

function cssPxPerMm(): number {
  return calibration?.cssPxPerMm ?? DEFAULT_CSS_PX_PER_MM;
}

function configureContext(): void {
  const dpr = window.devicePixelRatio || 1;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.lineCap = "round";
  context.lineJoin = "round";
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

function drawLandmark(point: { x: number; y: number }): void {
  context.beginPath();
  context.arc(point.x, point.y, 6, 0, Math.PI * 2);
  context.fillStyle = "#fffefa";
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = "#171717";
  context.stroke();
}

function drawRawStroke(stroke: RawStroke): void {
  if (stroke.samples.length === 0) return;
  context.strokeStyle = "#171717";
  context.fillStyle = "#171717";
  context.lineWidth = 2.2;
  context.setLineDash([]);
  context.beginPath();
  context.arc(stroke.samples[0].xCss, stroke.samples[0].yCss, context.lineWidth / 2, 0, Math.PI * 2);
  context.fill();
  if (stroke.samples.length < 2) return;
  context.beginPath();
  context.moveTo(stroke.samples[0].xCss, stroke.samples[0].yCss);
  for (let index = 1; index < stroke.samples.length; index += 1) {
    context.lineTo(stroke.samples[index].xCss, stroke.samples[index].yCss);
  }
  context.stroke();
}

function drawIdealLine(lineTarget: LineTarget): void {
  context.save();
  context.beginPath();
  context.moveTo(lineTarget.aCss.x, lineTarget.aCss.y);
  context.lineTo(lineTarget.bCss.x, lineTarget.bCss.y);
  context.strokeStyle = "#1557c0";
  context.lineWidth = 2;
  context.setLineDash([8, 6]);
  context.stroke();
  context.restore();
}

function redrawAll(): void {
  const bounds = canvas.getBoundingClientRect();
  context.clearRect(0, 0, bounds.width, bounds.height);
  if (!target) return;
  if (activeStroke) drawRawStroke(activeStroke);
  else if (completedStroke) drawRawStroke(completedStroke);
  if (trialState === "FEEDBACK") drawIdealLine(target);
  drawLandmark(target.aCss);
  drawLandmark(target.bCss);
}

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum);
}

function targetFits(candidate: LineTarget, width: number, height: number, margin: number): boolean {
  return [candidate.aCss, candidate.bCss].every((point) => (
    point.x >= margin && point.x <= width - margin && point.y >= margin && point.y <= height - margin
  ));
}

function generateLineTarget(): LineTarget {
  const bounds = canvas.getBoundingClientRect();
  const margin = Math.min(72, Math.max(34, Math.min(bounds.width, bounds.height) * 0.09));
  const scale = cssPxPerMm();
  const availableLongSideMm = Math.max(bounds.width, bounds.height) / scale;
  const maximumMm = Math.max(55, Math.min(180, availableLongSideMm * 0.72));
  const minimumMm = Math.min(80, maximumMm * 0.72);

  for (let attempt = 0; attempt < 160; attempt += 1) {
    const lengthMm = randomBetween(minimumMm, maximumMm);
    const lengthCss = lengthMm * scale;
    const angle = randomBetween(0, Math.PI * 2);
    const center = {
      x: randomBetween(margin, bounds.width - margin),
      y: randomBetween(margin, bounds.height - margin),
    };
    const halfX = Math.cos(angle) * lengthCss / 2;
    const halfY = Math.sin(angle) * lengthCss / 2;
    const candidate: LineTarget = {
      kind: "LINE",
      aCss: { x: center.x - halfX, y: center.y - halfY },
      bCss: { x: center.x + halfX, y: center.y + halfY },
      lengthMm,
    };
    if (targetFits(candidate, bounds.width, bounds.height, margin)) return candidate;
  }

  const y = bounds.height / 2;
  const aCss = { x: margin, y };
  const bCss = { x: bounds.width - margin, y };
  return { kind: "LINE", aCss, bCss, lengthMm: (bCss.x - aCss.x) / scale };
}

function beginNewTrial(): void {
  trialState = "PREPARING";
  activePointerId = null;
  activeStroke = null;
  activeSampleKeys = new Set<string>();
  completedStroke = null;
  lastAnalysis = null;
  feedbackCard.hidden = true;
  feedbackCard.classList.remove("failed");
  target = generateLineTarget();
  trialState = "READY";
  setStatus("Draw one committed line between the points");
  emptyState.classList.toggle("hidden", hasPractisedBefore || sessionReps > 0);
  redrawAll();
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
  let requiresSort = false;

  for (const sourceEvent of sourceEvents(event)) {
    const sample = eventToSample(sourceEvent, sourceEventType);
    const identity = rawSampleIdentity(sample);
    if (activeSampleKeys.has(identity)) {
      runtime.duplicateSampleCount += 1;
      continue;
    }
    activeSampleKeys.add(identity);
    const previous = activeStroke.samples.at(-1);
    if (previous && sample.tMs < previous.tMs) requiresSort = true;
    activeStroke.samples.push(sample);
    runtime.rawSampleCount += 1;
    runtime.pressureObserved ||= (sample.pressure ?? 0) > 0;
    runtime.tiltObserved ||= (sample.tiltX ?? 0) !== 0 || (sample.tiltY ?? 0) !== 0;
  }

  if (requiresSort) {
    activeStroke.samples.sort((a, b) => a.tMs - b.tMs);
    runtime.reorderedSampleCount += 1;
  }
  redrawAll();
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
  if (trialState !== "READY" || activePointerId !== null) return;

  event.preventDefault();
  activePointerId = event.pointerId;
  activeSampleKeys = new Set<string>();
  activeStroke = {
    id: createId(),
    pointerType: event.pointerType,
    startedAtEpochMs: Date.now(),
    cancelled: false,
    samples: [],
  };
  trialState = "DRAWING";
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // The pointer may already have ended.
  }
  emptyState.classList.add("hidden");
  setStatus("Drawing — commit to the movement");
  appendPointerSamples(event, "pointerdown");
}

function handlePointerMove(event: PointerEvent): void {
  if (event.pointerId !== activePointerId || trialState !== "DRAWING") return;
  event.preventDefault();
  appendPointerSamples(event, "pointermove");
}

function updatePracticeHud(analysis: LineAnalysis): void {
  sessionReps += 1;
  repCount.textContent = sessionReps.toLocaleString();
  if (analysis.executionPassed) {
    sessionStreak += 1;
    const score = analysis.accuracyScore ?? 0;
    lastScore.textContent = String(score);
    lifetimeBest = lifetimeBest === null ? score : Math.max(lifetimeBest, score);
    bestScore.textContent = String(lifetimeBest);
  } else {
    sessionStreak = 0;
    lastScore.textContent = "—";
  }
  streakCount.textContent = String(sessionStreak);
}

function showFeedback(analysis: LineAnalysis): void {
  feedbackCard.hidden = false;
  if (analysis.executionPassed) {
    feedbackResult.textContent = "Committed stroke ✓";
    feedbackScore.textContent = `Accuracy ${analysis.accuracyScore ?? 0}`;
    feedbackDetail.textContent = `RMS error ${analysis.metrics.rmsOrthogonalDeviationMm.toFixed(1)} mm · endpoints ${analysis.metrics.endpointMeanErrorMm.toFixed(1)} mm`;
    setStatus("Feedback shown — ideal line in blue");
  } else {
    feedbackCard.classList.add("failed");
    feedbackResult.textContent = "Execution not scored";
    feedbackScore.textContent = analysis.executionReason ?? "Try another line";
    feedbackDetail.textContent = "Accuracy is hidden when the movement is too corrective.";
    setStatus("No accuracy score — commit to the next one");
  }
}

async function finishStroke(event: PointerEvent, cancelled: boolean): Promise<void> {
  if (event.pointerId !== activePointerId || !activeStroke || !target) return;
  event.preventDefault();
  if (!cancelled) appendPointerSamples(event, "pointerup");
  trialState = "PROCESSING";

  const stroke = activeStroke;
  stroke.cancelled = cancelled;
  stroke.completedAtEpochMs = Date.now();
  completedStroke = stroke;
  activeStroke = null;
  activePointerId = null;

  if (cancelled) {
    setStatus("Stroke interrupted — new line ready");
    try {
      await saveStroke(stroke);
      savedStrokeCount += 1;
    } catch {
      showToast("Interrupted stroke could not be saved");
    }
    beginNewTrial();
    return;
  }

  try {
    const analysis = analyseLineStroke(stroke, target, cssPxPerMm());
    lastAnalysis = analysis;
    const trial: LineTrialRecord = {
      id: createId(),
      appVersion: APP_VERSION,
      metricVersion: METRIC_VERSION,
      scoringVersion: SCORING_VERSION,
      createdAtEpochMs: Date.now(),
      target,
      rawStroke: stroke,
      calibrationId: calibration?.id ?? null,
      derived: analysis,
    };
    await Promise.all([saveStroke(stroke), saveTrial(trial)]);
    savedStrokeCount += 1;
    savedTrialCount += 1;
    hasPractisedBefore = true;
    updatePracticeHud(analysis);
    trialState = "FEEDBACK";
    showFeedback(analysis);
    redrawAll();
  } catch {
    trialState = "FEEDBACK";
    feedbackCard.hidden = false;
    feedbackCard.classList.add("failed");
    feedbackResult.textContent = "Couldn’t evaluate this stroke";
    feedbackScore.textContent = "Try another line";
    feedbackDetail.textContent = "The raw stroke was kept for diagnostics.";
    setStatus("Evaluation failed — raw stroke preserved");
    redrawAll();
  }
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
    beginNewTrial();
  } catch {
    showToast("Calibration could not be saved");
  }
}

function updateScaleStatus(): void {
  scaleStatus.textContent = calibration
    ? `Calibrated · ${calibration.cssPxPerMm.toFixed(2)} px/mm`
    : "Scale provisional · calibrate with a ruler";
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
  const stroke = completedStroke;
  const duration = stroke && stroke.samples.length > 1 ? stroke.samples.at(-1)!.tMs - stroke.samples[0].tMs : 0;
  const rate = duration > 0 && stroke ? Math.round(((stroke.samples.length - 1) * 1000) / duration) : 0;
  return {
    "App version": APP_VERSION,
    "Metric version": METRIC_VERSION,
    "User agent": device.userAgent,
    "Viewport (CSS px)": `${device.viewportWidthCssPx} × ${device.viewportHeightCssPx}`,
    "Device pixel ratio": device.devicePixelRatio,
    "Pointer Events": device.pointerEvents,
    "Coalesced events API": device.coalescedEvents,
    "Pressure observed": runtime.pressureObserved,
    "Tilt observed": runtime.tiltObserved,
    "Last pointer": stroke?.pointerType ?? "None",
    "Last unique samples": stroke?.samples.length ?? 0,
    "Last unique sample rate": rate ? `${rate} Hz` : "No stroke captured",
    "Timestamp delta histogram (ms)": timestampHistogram(stroke),
    "Overlapping samples removed": runtime.duplicateSampleCount,
    "Out-of-order batches repaired": runtime.reorderedSampleCount,
    "Finger touches ignored": runtime.ignoredTouchCount,
    "Calibration": calibration ? `${calibration.cssPxPerMm.toFixed(4)} CSS px/mm` : "Not calibrated",
    "Last RMS error": lastAnalysis ? `${lastAnalysis.metrics.rmsOrthogonalDeviationMm.toFixed(3)} mm` : "No scored trial",
    "Saved input strokes": savedStrokeCount,
    "Saved line trials": savedTrialCount,
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
    const [strokes, trials] = await Promise.all([getStrokes(), getTrials()]);
    const bundle: ExportBundle = {
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt: Date.now(),
      calibration,
      device: getDeviceSnapshot(),
      strokes,
      trials,
    };
    downloadJson(`circle-trainer-${dateStamp()}.json`, bundle);
    showToast("JSON export created");
  } catch {
    showToast("Data export failed");
  }
}

async function showDataDialog(): Promise<void> {
  try {
    const [strokes, trials] = await Promise.all([getStrokes(), getTrials()]);
    savedStrokeCount = strokes.length;
    savedTrialCount = trials.length;
    const samples = strokes.reduce((total, stroke) => total + stroke.samples.length, 0);
    dataSummary.textContent = trials.length === 0
      ? `${strokes.length.toLocaleString()} input-test strokes are saved. No line trials yet.`
      : `${trials.length.toLocaleString()} line trials and ${samples.toLocaleString()} raw samples are saved in this browser.`;
  } catch {
    dataSummary.textContent = "Saved data could not be read in this browser.";
  }
  dataDialog.showModal();
}

async function deleteAllData(): Promise<void> {
  const confirmed = window.confirm("Delete every saved stroke and trial from this browser? This cannot be undone.");
  if (!confirmed) return;
  try {
    await Promise.all([clearStrokes(), clearTrials()]);
    savedStrokeCount = 0;
    savedTrialCount = 0;
    sessionReps = 0;
    sessionStreak = 0;
    lifetimeBest = null;
    hasPractisedBefore = false;
    repCount.textContent = "0";
    streakCount.textContent = "0";
    lastScore.textContent = "—";
    bestScore.textContent = "—";
    dataSummary.textContent = "No practice trials saved yet.";
    dataDialog.close();
    beginNewTrial();
    showToast("All practice data deleted");
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
  requiredElement<HTMLButtonElement>("#newTrialButton").addEventListener("click", beginNewTrial);
  requiredElement<HTMLButtonElement>("#nextTrialButton").addEventListener("click", beginNewTrial);
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
  window.addEventListener("resize", () => {
    resizeCanvas();
    if (trialState !== "DRAWING") beginNewTrial();
  });
}

async function initialize(): Promise<void> {
  wireControls();
  resizeCanvas();
  try {
    const [storedCalibration, strokes, trials] = await Promise.all([getCalibration(), getStrokes(), getTrials()]);
    calibration = storedCalibration;
    savedStrokeCount = strokes.length;
    savedTrialCount = trials.length;
    hasPractisedBefore = trials.length > 0;
    const scores = trials.flatMap((trial) => trial.derived.accuracyScore ?? []);
    lifetimeBest = scores.length > 0 ? Math.max(...scores) : null;
    bestScore.textContent = lifetimeBest === null ? "—" : String(lifetimeBest);
  } catch {
    showToast("Local storage is unavailable; drawing still works");
  }
  updateScaleStatus();
  configureRuler();
  beginNewTrial();

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
