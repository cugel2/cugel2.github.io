import "./styles.css";

import { rawSampleIdentity } from "./core/input";
import { analyseTargetStroke, versionsForExercise } from "./core/primitiveMetrics";
import { EXERCISE_LABELS, MODE_LABELS, PracticeScheduler } from "./core/scheduler";
import { generateTarget, sampleTargetPathCss, targetCheckpointsCss } from "./core/targets";
import type {
  AnalysisResult,
  DeviceSnapshot,
  ExerciseType,
  ExportBundle,
  PhysicalCalibration,
  PracticeMode,
  PrimitiveMetrics,
  RawSample,
  RawStroke,
  StrokeEventType,
  TargetDefinition,
  TrialRecord,
} from "./core/types";
import {
  clearStrokes,
  clearTrials,
  getCalibration,
  getPracticeMode,
  getStrokes,
  getTrials,
  saveCalibration,
  savePracticeMode,
  saveStroke,
  saveTrial,
} from "./storage";

const APP_VERSION = "0.3.2";
const SCHEMA_VERSION = "2" as const;
const DEFAULT_CSS_PX_PER_MM = 96 / 25.4;
const DEFAULT_RULER_WIDTH_CSS_PX = 378;
const VALID_MODES: readonly PracticeMode[] = ["LINE", "ARC", "CIRCLE", "ELLIPSE", "S_CURVE", "MIXED_BLOCKED", "MIXED_RANDOM"];

type TrialState = "PREPARING" | "READY" | "DRAWING" | "PROCESSING" | "FEEDBACK";

const INSTRUCTIONS: Record<ExerciseType, { kicker: string; prompt: string }> = {
  LINE: { kicker: "Line practice", prompt: "Draw one committed stroke between the two points." },
  ARC: { kicker: "Arc practice", prompt: "Draw one smooth arc through the three points." },
  CIRCLE: { kicker: "Circle practice", prompt: "Draw one full circle through the four points." },
  ELLIPSE: { kicker: "Ellipse practice", prompt: "Draw one full ellipse through the four points." },
  S_CURVE: { kicker: "S-curve practice", prompt: "Draw one smooth S curve through the four points." },
};

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
const instructionType = requiredElement<HTMLElement>("#instructionType");
const instructionText = requiredElement<HTMLElement>("#instructionText");
const scaleStatus = requiredElement<HTMLElement>("#scaleStatus");
const repCount = requiredElement<HTMLElement>("#repCount");
const streakCount = requiredElement<HTMLElement>("#streakCount");
const lastScore = requiredElement<HTMLElement>("#lastScore");
const bestScore = requiredElement<HTMLElement>("#bestScore");
const feedbackCard = requiredElement<HTMLElement>("#feedbackCard");
const feedbackResult = requiredElement<HTMLElement>("#feedbackResult");
const feedbackScore = requiredElement<HTMLElement>("#feedbackScore");
const feedbackDetail = requiredElement<HTMLElement>("#feedbackDetail");
const modeSelect = requiredElement<HTMLSelectElement>("#practiceModeSelect");
const nextTrialButton = requiredElement<HTMLButtonElement>("#nextTrialButton");
const toast = requiredElement<HTMLElement>("#toast");

const calibrationDialog = requiredElement<HTMLDialogElement>("#calibrationDialog");
const rulerLine = requiredElement<HTMLElement>("#rulerLine");
const rulerSlider = requiredElement<HTMLInputElement>("#rulerSlider");
const rulerOutput = requiredElement<HTMLOutputElement>("#rulerOutput");
const diagnosticsDialog = requiredElement<HTMLDialogElement>("#diagnosticsDialog");
const diagnosticGrid = requiredElement<HTMLElement>("#diagnosticGrid");
const dataDialog = requiredElement<HTMLDialogElement>("#dataDialog");
const dataSummary = requiredElement<HTMLElement>("#dataSummary");

const runtime = {
  pointerEventCount: 0,
  rawSampleCount: 0,
  duplicateSampleCount: 0,
  reorderedSampleCount: 0,
  ignoredTouchCount: 0,
  pressureObserved: false,
  tiltObserved: false,
};

let calibration: PhysicalCalibration | null = null;
let selectedMode: PracticeMode = "LINE";
let scheduler = new PracticeScheduler("LINE", createId());
let targetGenerationIndex = 0;
let activeExercise: ExerciseType = "LINE";
let trialState: TrialState = "PREPARING";
let target: TargetDefinition | null = null;
let activePointerId: number | null = null;
let activeStroke: RawStroke | null = null;
let activeSampleKeys = new Set<string>();
let completedStroke: RawStroke | null = null;
let lastAnalysis: AnalysisResult<PrimitiveMetrics> | null = null;
let sessionReps = 0;
let sessionStreak = 0;
let bestByExercise: Partial<Record<ExerciseType, number>> = {};
let savedStrokeCount = 0;
let savedTrialCount = 0;
let toastTimer: number | undefined;
let touchNoticeShown = false;
const introducedExercises = new Set<ExerciseType>();

function createId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getDeviceSnapshot(): DeviceSnapshot {
  return {
    userAgent: navigator.userAgent,
    viewportWidthCssPx: window.innerWidth,
    viewportHeightCssPx: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    pointerEvents: "PointerEvent" in window,
    coalescedEvents: "PointerEvent" in window && typeof PointerEvent.prototype.getCoalescedEvents === "function",
  };
}

function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2200);
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
  for (let index = 1; index < stroke.samples.length; index += 1) context.lineTo(stroke.samples[index].xCss, stroke.samples[index].yCss);
  context.stroke();
}

function drawIdealTarget(targetDefinition: TargetDefinition): void {
  const path = sampleTargetPathCss(targetDefinition, cssPxPerMm(), 512);
  context.save();
  context.beginPath();
  context.moveTo(path[0].x, path[0].y);
  for (let index = 1; index < path.length; index += 1) context.lineTo(path[index].x, path[index].y);
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
  if (trialState === "FEEDBACK") drawIdealTarget(target);
  targetCheckpointsCss(target, cssPxPerMm()).forEach(drawLandmark);
}

function statusForCurrentTrial(): string {
  const exerciseLabel = EXERCISE_LABELS[activeExercise];
  if (selectedMode === "MIXED_BLOCKED") {
    const progress = scheduler.blockProgress()!;
    return `${MODE_LABELS[selectedMode]} · ${exerciseLabel} ${progress.current}/${progress.total}`;
  }
  if (selectedMode === "MIXED_RANDOM") return `${MODE_LABELS[selectedMode]} · ${exerciseLabel}`;
  return `Draw one committed ${exerciseLabel.toLowerCase().replace(/s$/, "")} through the checkpoints`;
}

function updateBestHud(): void {
  const best = bestByExercise[activeExercise];
  bestScore.textContent = best === undefined ? "—" : String(best);
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
  activeExercise = scheduler.currentExercise();
  const bounds = canvas.getBoundingClientRect();
  target = generateTarget(
    activeExercise,
    { width: bounds.width, height: bounds.height },
    cssPxPerMm(),
    scheduler.sessionSeed,
    targetGenerationIndex,
  );
  targetGenerationIndex += 1;
  const instruction = INSTRUCTIONS[activeExercise];
  instructionType.textContent = instruction.kicker;
  instructionText.textContent = instruction.prompt;
  nextTrialButton.textContent = `Next ${EXERCISE_LABELS[activeExercise].toLowerCase().replace(/s$/, "")}`;
  trialState = "READY";
  statusText.textContent = statusForCurrentTrial();
  emptyState.classList.toggle("hidden", introducedExercises.has(activeExercise));
  updateBestHud();
  redrawAll();
}

function resetSession(mode: PracticeMode): void {
  selectedMode = mode;
  scheduler = new PracticeScheduler(mode, createId());
  targetGenerationIndex = 0;
  sessionReps = 0;
  sessionStreak = 0;
  repCount.textContent = "0";
  streakCount.textContent = "0";
  lastScore.textContent = "—";
  modeSelect.value = mode;
  beginNewTrial();
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

function handlePointerDown(event: PointerEvent): void {
  if (event.pointerType !== "pen" && event.pointerType !== "mouse") {
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
  activeStroke = { id: createId(), pointerType: event.pointerType, startedAtEpochMs: Date.now(), cancelled: false, samples: [] };
  trialState = "DRAWING";
  try { canvas.setPointerCapture(event.pointerId); } catch { /* Pointer already ended. */ }
  introducedExercises.add(activeExercise);
  emptyState.classList.add("hidden");
  statusText.textContent = `${EXERCISE_LABELS[activeExercise]} · commit to the movement`;
  appendPointerSamples(event, "pointerdown");
}

function handlePointerMove(event: PointerEvent): void {
  if (event.pointerId !== activePointerId || trialState !== "DRAWING") return;
  event.preventDefault();
  appendPointerSamples(event, "pointermove");
}

function updatePracticeHud(analysis: AnalysisResult): void {
  sessionReps += 1;
  repCount.textContent = sessionReps.toLocaleString();
  if (analysis.executionPassed) {
    sessionStreak += 1;
    const value = analysis.accuracyScore ?? 0;
    lastScore.textContent = String(value);
    bestByExercise[activeExercise] = Math.max(bestByExercise[activeExercise] ?? 0, value);
  } else {
    sessionStreak = 0;
    lastScore.textContent = "—";
  }
  streakCount.textContent = String(sessionStreak);
  updateBestHud();
}

function feedbackDetails(analysis: AnalysisResult): string {
  const metrics = analysis.metrics;
  if (activeExercise === "LINE" && "rmsOrthogonalDeviationMm" in metrics) {
    return `RMS error ${metrics.rmsOrthogonalDeviationMm.toFixed(1)} mm · endpoints ${metrics.endpointMeanErrorMm.toFixed(1)} mm`;
  }
  if (activeExercise === "CIRCLE" && "radialRmsMm" in metrics) {
    return `Radial error ${metrics.radialRmsMm.toFixed(1)} mm · closure ${metrics.closureMm.toFixed(1)} mm`;
  }
  if (activeExercise === "ELLIPSE" && "closureMm" in metrics) {
    return `Path error ${metrics.rmsDeviationMm.toFixed(1)} mm · closure ${metrics.closureMm.toFixed(1)} mm`;
  }
  if ("endpointMeanErrorMm" in metrics) {
    const pathError = "rmsDeviationMm" in metrics ? metrics.rmsDeviationMm : metrics.rmsOrthogonalDeviationMm;
    return `Path error ${pathError.toFixed(1)} mm · endpoints ${metrics.endpointMeanErrorMm.toFixed(1)} mm`;
  }
  return `Path error ${("rmsDeviationMm" in metrics ? metrics.rmsDeviationMm : 0).toFixed(1)} mm`;
}

function showFeedback(analysis: AnalysisResult): void {
  feedbackCard.hidden = false;
  nextTrialButton.textContent = "Next";
  if (analysis.executionPassed) {
    feedbackResult.textContent = `Committed ${EXERCISE_LABELS[activeExercise].toLowerCase().replace(/s$/, "")} ✓`;
    feedbackScore.textContent = `Accuracy ${analysis.accuracyScore ?? 0}`;
    feedbackDetail.textContent = feedbackDetails(analysis);
    statusText.textContent = "Feedback shown — ideal path in blue";
  } else {
    feedbackCard.classList.add("failed");
    feedbackResult.textContent = "Execution not scored";
    feedbackScore.textContent = analysis.executionReason ?? "Try another one";
    feedbackDetail.textContent = "Accuracy is hidden when the movement is incomplete or too corrective.";
    statusText.textContent = "No accuracy score — commit to the next one";
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
    try { await saveStroke(stroke); savedStrokeCount += 1; } catch { showToast("Interrupted stroke could not be saved"); }
    beginNewTrial();
    return;
  }

  try {
    const analysis = analyseTargetStroke(stroke, target, cssPxPerMm());
    lastAnalysis = analysis;
    const versions = versionsForExercise(activeExercise);
    const schedule = { ...scheduler.context(), generationIndex: targetGenerationIndex - 1 };
    const trial: TrialRecord = {
      id: createId(),
      appVersion: APP_VERSION,
      metricVersion: versions.metric,
      scoringVersion: versions.scoring,
      createdAtEpochMs: Date.now(),
      exerciseType: activeExercise,
      practiceMode: selectedMode,
      schedule,
      target,
      rawStroke: stroke,
      calibrationId: calibration?.id ?? null,
      derived: analysis,
    };
    await Promise.all([saveStroke(stroke), saveTrial(trial)]);
    savedStrokeCount += 1;
    savedTrialCount += 1;
    updatePracticeHud(analysis);
    scheduler.advance();
    trialState = "FEEDBACK";
    showFeedback(analysis);
    redrawAll();
  } catch {
    trialState = "FEEDBACK";
    feedbackCard.hidden = false;
    feedbackCard.classList.add("failed");
    feedbackResult.textContent = "Couldn’t evaluate this stroke";
    feedbackScore.textContent = "Try another one";
    feedbackDetail.textContent = "The raw stroke was kept for diagnostics.";
    statusText.textContent = "Evaluation failed — raw stroke preserved";
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
    id: createId(), cssPxPerMm: Number(rulerSlider.value) / 100, calibratedAt: Date.now(),
    viewportWidthCssPx: window.innerWidth, viewportHeightCssPx: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1,
  };
  try {
    await saveCalibration(calibration);
    updateScaleStatus();
    calibrationDialog.close();
    beginNewTrial();
    showToast("100 mm calibration saved");
  } catch { showToast("Calibration could not be saved"); }
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
    "Current mode": MODE_LABELS[selectedMode],
    "Current exercise": EXERCISE_LABELS[activeExercise],
    "Metric version": versionsForExercise(activeExercise).metric,
    "User agent": device.userAgent,
    "Viewport (CSS px)": `${device.viewportWidthCssPx} × ${device.viewportHeightCssPx}`,
    "Device pixel ratio": device.devicePixelRatio,
    "Pointer Events": device.pointerEvents,
    "Coalesced events API": device.coalescedEvents,
    "Pressure observed": runtime.pressureObserved,
    "Tilt observed": runtime.tiltObserved,
    "Last unique samples": stroke?.samples.length ?? 0,
    "Last unique sample rate": rate ? `${rate} Hz` : "No stroke captured",
    "Timestamp delta histogram (ms)": timestampHistogram(stroke),
    "Overlapping samples removed": runtime.duplicateSampleCount,
    "Out-of-order batches repaired": runtime.reorderedSampleCount,
    "Finger touches ignored": runtime.ignoredTouchCount,
    "Calibration": calibration ? `${calibration.cssPxPerMm.toFixed(4)} CSS px/mm` : "Not calibrated",
    "Last normalized error": lastAnalysis ? lastAnalysis.metrics.normalizedError.toFixed(5) : "No scored trial",
    "Saved input strokes": savedStrokeCount,
    "Saved trials": savedTrialCount,
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
      schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, exportedAt: Date.now(), calibration,
      selectedMode, device: getDeviceSnapshot(), strokes, trials,
    };
    downloadJson(`circle-trainer-${dateStamp()}.json`, bundle);
    showToast("JSON export created");
  } catch { showToast("Data export failed"); }
}

async function showDataDialog(): Promise<void> {
  try {
    const trials = await getTrials();
    savedTrialCount = trials.length;
    const counts = Object.fromEntries(Object.keys(EXERCISE_LABELS).map((type) => [type, 0])) as Record<ExerciseType, number>;
    trials.forEach((trial) => { counts[trial.exerciseType] += 1; });
    dataSummary.textContent = trials.length === 0
      ? "No practice trials saved yet."
      : `${trials.length.toLocaleString()} trials saved · ${counts.LINE} lines · ${counts.ARC} arcs · ${counts.CIRCLE} circles · ${counts.ELLIPSE} ellipses · ${counts.S_CURVE} S curves.`;
  } catch { dataSummary.textContent = "Saved data could not be read in this browser."; }
  dataDialog.showModal();
}

async function deleteAllData(): Promise<void> {
  if (!window.confirm("Delete every saved stroke and trial from this browser? This cannot be undone.")) return;
  try {
    await Promise.all([clearStrokes(), clearTrials()]);
    savedStrokeCount = 0;
    savedTrialCount = 0;
    bestByExercise = {};
    introducedExercises.clear();
    dataDialog.close();
    resetSession(selectedMode);
    showToast("All practice data deleted");
  } catch { showToast("Saved data could not be deleted"); }
}

async function copyDiagnostics(): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(buildDiagnosticReport(), null, 2));
    showToast("Diagnostics copied");
  } catch { showToast("Clipboard access was unavailable"); }
}

function wireControls(): void {
  requiredElement<HTMLButtonElement>("#newTrialButton").addEventListener("click", beginNewTrial);
  nextTrialButton.addEventListener("click", beginNewTrial);
  modeSelect.addEventListener("change", () => {
    const mode = modeSelect.value as PracticeMode;
    if (!VALID_MODES.includes(mode) || trialState === "DRAWING") {
      modeSelect.value = selectedMode;
      if (trialState === "DRAWING") showToast("Finish the current stroke before changing modes");
      return;
    }
    resetSession(mode);
    void savePracticeMode(mode).catch(() => showToast("Practice mode could not be saved"));
  });
  requiredElement<HTMLButtonElement>("#calibrateButton").addEventListener("click", () => { configureRuler(); calibrationDialog.showModal(); });
  requiredElement<HTMLButtonElement>("#diagnosticsButton").addEventListener("click", () => { renderDiagnostics(); diagnosticsDialog.showModal(); });
  requiredElement<HTMLButtonElement>("#dataButton").addEventListener("click", () => void showDataDialog());
  requiredElement<HTMLButtonElement>("#saveCalibrationButton").addEventListener("click", () => void persistCalibration());
  requiredElement<HTMLButtonElement>("#resetCalibrationButton").addEventListener("click", () => {
    rulerSlider.value = String(Math.min(Number(rulerSlider.max), DEFAULT_RULER_WIDTH_CSS_PX));
    updateRulerDisplay();
  });
  requiredElement<HTMLButtonElement>("#copyDiagnosticsButton").addEventListener("click", () => void copyDiagnostics());
  requiredElement<HTMLButtonElement>("#exportDiagnosticsButton").addEventListener("click", () => downloadJson(`circle-trainer-diagnostics-${dateStamp()}.json`, buildDiagnosticReport()));
  requiredElement<HTMLButtonElement>("#exportDataButton").addEventListener("click", () => void exportAllData());
  requiredElement<HTMLButtonElement>("#deleteDataButton").addEventListener("click", () => void deleteAllData());
  rulerSlider.addEventListener("input", updateRulerDisplay);
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", (event) => void finishStroke(event, false));
  canvas.addEventListener("pointercancel", (event) => void finishStroke(event, true));
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("resize", () => { resizeCanvas(); if (trialState !== "DRAWING") beginNewTrial(); });
}

async function initialize(): Promise<void> {
  wireControls();
  resizeCanvas();
  try {
    const [storedCalibration, storedMode, strokes, trials] = await Promise.all([getCalibration(), getPracticeMode(), getStrokes(), getTrials()]);
    calibration = storedCalibration;
    selectedMode = storedMode && VALID_MODES.includes(storedMode) ? storedMode : "LINE";
    savedStrokeCount = strokes.length;
    savedTrialCount = trials.length;
    for (const trial of trials) {
      introducedExercises.add(trial.exerciseType);
      const value = trial.derived.accuracyScore;
      if (value !== undefined) bestByExercise[trial.exerciseType] = Math.max(bestByExercise[trial.exerciseType] ?? 0, value);
    }
  } catch { showToast("Local storage is unavailable; drawing still works"); }
  updateScaleStatus();
  configureRuler();
  resetSession(selectedMode);
  if (new URLSearchParams(window.location.search).has("diagnostics") || window.location.hash === "#diagnostics") {
    renderDiagnostics();
    diagnosticsDialog.showModal();
  }
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => { void navigator.serviceWorker.register("./service-worker.js").catch(() => undefined); });
  }
}

void initialize();
