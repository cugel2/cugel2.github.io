import "./styles.css";

import { arrowLabelCss, BOX_EDGES, BOX_FACES, BOX_STROKES_REQUIRED, boxAreas, boxShading, nonHingeEdgeIndices, swingArrowCss } from "./core/box";
import { analyseBoxStrokes } from "./core/boxMetrics";
import { polylineLength } from "./core/geometry";
import { rawSampleIdentity } from "./core/input";
import { drawVariableWidthStroke } from "./core/strokeRender";
import { bestTrialsByExercise } from "./core/trophies";
import { analyseTargetStroke, versionsForExercise } from "./core/primitiveMetrics";
import { ALL_EXERCISE_TYPES, EXERCISE_LABELS, MODE_LABELS, PracticeScheduler } from "./core/scheduler";
import { generateTarget, sampleTargetPathCss, targetCheckpointsCss } from "./core/targets";
import { strokeWidthsMm, taperCheckpointsCss, taperMetricText, taperOutlineCss, targetWidthAtMm } from "./core/taper";
import type {
  AnalysisResult,
  BoxMetrics,
  BoxTarget,
  BoxTrialRecord,
  DeviceSnapshot,
  ExerciseType,
  ExportBundle,
  PhysicalCalibration,
  PracticeMode,
  SingleStrokeExerciseType,
  PrimitiveMetrics,
  RawSample,
  RawStroke,
  SingleStrokeTrialRecord,
  StrokeEventType,
  TaperTarget,
  TargetDefinition,
  TrialRecord,
} from "./core/types";
import { DEFAULT_HANDEDNESS, type Handedness } from "./core/types";
import {
  clearStrokes,
  clearTrials,
  getCalibration,
  getCorrectionGateEnabled,
  getDailyQueue,
  getDailyTicks,
  getHandedness,
  getPracticeTime,
  getPracticeMode,
  getStrokes,
  getTrials,
  saveCalibration,
  saveCorrectionGateEnabled,
  saveDailyQueue,
  saveDailyTicks,
  saveHandedness,
  savePracticeTime,
  savePracticeMode,
  saveStroke,
  saveTrial,
} from "./storage";
import { createTrophyView } from "./trophyView";
import { createCopyView } from "./copy/copyView";
import { dayKey, formatClock, formatMinutes, PracticeClock } from "./core/timer";
import {
  advanceQueue,
  currentQueueExercise,
  DAILY_COUNTS,
  dailyMinutes,
  DEFAULT_DAILY_TICKS,
  ensureTodayQueue,
  isQueueDone,
  queueMinutesLeft,
  queueRemaining,
  type DailyQueueState,
} from "./core/dailyQueue";

const APP_VERSION = "0.9.0";
const SCHEMA_VERSION = "3" as const;
const DEFAULT_CSS_PX_PER_MM = 96 / 25.4;
const DEFAULT_RULER_WIDTH_CSS_PX = 378;
const VALID_MODES: readonly PracticeMode[] = ["LINE", "ARC", "CIRCLE", "ELLIPSE", "S_CURVE", "TAPER", "BOX", "MIXED_BLOCKED", "MIXED_RANDOM", "TODAY"];
/** Box strokes shorter than this (or with fewer samples) are treated as accidental taps and not counted. */
const BOX_MIN_STROKE_SAMPLES = 8;
const BOX_MIN_STROKE_PATH_MM = 6;
const BOX_ACCENT = "#d2691e";
const BOX_REFERENCE_GREY = "#9a968d";
/** Hidden reference edges: the same grey, fainter, so the wireframe reads one way only. */
const BOX_HIDDEN_EDGE = "rgba(154, 150, 141, 0.38)";
const BOX_FACE_SHADE = "rgba(120, 114, 104, 0.16)";
const BOX_ANSWER_FACE_SHADE = "rgba(21, 87, 192, 0.14)";
/** The same face after the swing, when it has turned away from the viewer. */
const BOX_ANSWER_FACE_SHADE_AWAY = "rgba(21, 87, 192, 0.05)";

type TrialState = "PREPARING" | "READY" | "DRAWING" | "PROCESSING" | "FEEDBACK";

const INSTRUCTIONS: Record<ExerciseType, { kicker: string; prompt: string }> = {
  LINE: { kicker: "Line practice", prompt: "Draw one committed stroke between the two points." },
  ARC: { kicker: "Arc practice", prompt: "Draw one smooth arc through the three points." },
  CIRCLE: { kicker: "Circle practice", prompt: "Draw one full circle through the four points." },
  ELLIPSE: { kicker: "Ellipse practice", prompt: "Draw one full ellipse through the four points." },
  S_CURVE: { kicker: "S-curve practice", prompt: "Draw one smooth S curve through the four points." },
  TAPER: { kicker: "Taper practice", prompt: "Draw one straight stroke through the three dots, pressing so its width matches each dot." },
  BOX: { kicker: "Box practice", prompt: "Swing the box about the orange edge by the angle shown, then draw its other 11 edges from the lone orange edge — one stroke each." },
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
const instructionNote = requiredElement<HTMLElement>("#emptyState span");
const DEFAULT_INSTRUCTION_NOTE = instructionNote.textContent ?? "";
const scaleStatus = requiredElement<HTMLElement>("#scaleStatus");
const repCount = requiredElement<HTMLElement>("#repCount");
const streakCount = requiredElement<HTMLElement>("#streakCount");
const lastScore = requiredElement<HTMLElement>("#lastScore");
const practiceTime = requiredElement<HTMLElement>("#practiceTime");
const doneCard = requiredElement<HTMLElement>("#doneCard");
const doneTitle = requiredElement<HTMLElement>("#doneTitle");
const doneDetail = requiredElement<HTMLElement>("#doneDetail");
const doneNote = requiredElement<HTMLElement>("#doneNote");
const doneSettingsButton = requiredElement<HTMLButtonElement>("#doneSettingsButton");
const dailyTicksList = requiredElement<HTMLElement>("#dailyTicks");
const dailyEstimate = requiredElement<HTMLElement>("#dailyEstimate");
const bestScore = requiredElement<HTMLElement>("#bestScore");
const feedbackCard = requiredElement<HTMLElement>("#feedbackCard");
const feedbackResult = requiredElement<HTMLElement>("#feedbackResult");
const feedbackScore = requiredElement<HTMLElement>("#feedbackScore");
const feedbackDetail = requiredElement<HTMLElement>("#feedbackDetail");
const modeSelect = requiredElement<HTMLSelectElement>("#practiceModeSelect");
const correctionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#correctionGateSetting button[data-corrections]"));
const nextTrialButton = requiredElement<HTMLButtonElement>("#nextTrialButton");
const undoStrokeButton = requiredElement<HTMLButtonElement>("#undoStrokeButton");
const boxTipsButton = requiredElement<HTMLButtonElement>("#boxTipsButton");
const boxTipsPanel = requiredElement<HTMLElement>("#boxTipsPanel");
const BOX_TIPS_OPEN_KEY = "circle-trainer:box-tips-open";
const toast = requiredElement<HTMLElement>("#toast");

const calibrationDialog = requiredElement<HTMLDialogElement>("#calibrationDialog");
const handButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".hand-setting button[data-hand]"));
const drawingStage = requiredElement<HTMLElement>(".drawing-stage");
const rulerLine = requiredElement<HTMLElement>("#rulerLine");
const rulerSlider = requiredElement<HTMLInputElement>("#rulerSlider");
const rulerOutput = requiredElement<HTMLOutputElement>("#rulerOutput");
const diagnosticsDialog = requiredElement<HTMLDialogElement>("#diagnosticsDialog");
const diagnosticGrid = requiredElement<HTMLElement>("#diagnosticGrid");
const dataDialog = requiredElement<HTMLDialogElement>("#dataDialog");
const dataSummary = requiredElement<HTMLElement>("#dataSummary");
const trophyDialog = requiredElement<HTMLDialogElement>("#trophyDialog");
const trophyIntro = requiredElement<HTMLElement>("#trophyIntro");
const trophyView = createTrophyView({
  grid: requiredElement<HTMLElement>("#trophyGrid"),
  detail: requiredElement<HTMLElement>("#trophyDetail"),
  detailTitle: requiredElement<HTMLElement>("#trophyDetailTitle"),
  detailScore: requiredElement<HTMLElement>("#trophyDetailScore"),
  detailMeta: requiredElement<HTMLElement>("#trophyDetailMeta"),
  detailMetrics: requiredElement<HTMLElement>("#trophyDetailMetrics"),
  detailCanvas: requiredElement<HTMLCanvasElement>("#trophyDetailCanvas"),
}, (trial) => trialCssPxPerMm(trial));

const appShell = requiredElement<HTMLElement>(".app-shell");
/** Copy mode is not a practice mode: no target, score or trial. This flag sits beside selectedMode. */
let copyActive = false;
const COPY_ACTIVE_KEY = "circle-trainer:copy-active";
const copyView = createCopyView({
  stage: requiredElement<HTMLElement>("#copyStage"),
  referencePane: requiredElement<HTMLElement>("#copyReferencePane"),
  drawingPane: requiredElement<HTMLElement>("#copyDrawingPane"),
  referenceCanvas: requiredElement<HTMLCanvasElement>("#copyReferenceCanvas"),
  drawingCanvas: requiredElement<HTMLCanvasElement>("#copyDrawingCanvas"),
  fileInput: requiredElement<HTMLInputElement>("#copyFileInput"),
  emptyState: requiredElement<HTMLElement>("#copyEmpty"),
  referenceBar: requiredElement<HTMLElement>("#copyReferenceBar"),
  drawingBar: requiredElement<HTMLElement>("#copyDrawingBar"),
  drawTools: requiredElement<HTMLElement>("#copyDrawTools"),
  bookName: requiredElement<HTMLElement>("#copyBookName"),
  backToFrameButton: requiredElement<HTMLButtonElement>("#copyBackToFrameButton"),
  compareBar: requiredElement<HTMLElement>("#copyCompareBar"),
  compareButtons: Array.from(document.querySelectorAll<HTMLButtonElement>("#copyCompareBar button[data-compare]")),
  opacityInput: requiredElement<HTMLInputElement>("#copyOpacityInput"),
  tintButton: requiredElement<HTMLButtonElement>("#copyTintButton"),
  undoButton: requiredElement<HTMLButtonElement>("#copyUndoButton"),
  clearButton: requiredElement<HTMLButtonElement>("#copyClearButton"),
  newButton: requiredElement<HTMLButtonElement>("#copyNewButton"),
  compareButton: requiredElement<HTMLButtonElement>("#copyCompareButton"),
  saveButton: requiredElement<HTMLButtonElement>("#copySaveButton"),
  saveDialog: requiredElement<HTMLDialogElement>("#copySaveDialog"),
  saveDrawingButton: requiredElement<HTMLButtonElement>("#copySaveDrawingButton"),
  saveSideBySideButton: requiredElement<HTMLButtonElement>("#copySaveSideBySideButton"),
  saveNote: requiredElement<HTMLElement>("#copySaveNote"),
  savePreview: requiredElement<HTMLElement>("#copySavePreview"),
  savePreviewImage: requiredElement<HTMLImageElement>("#copySavePreviewImage"),
  saveDownloadLink: requiredElement<HTMLAnchorElement>("#copySaveDownloadLink"),
}, {
  pxPerMm: () => cssPxPerMm(),
  handedness: () => handedness,
  onActivity: (ended) => {
    practiceClock.recordActivity(Date.now());
    if (ended) persistPracticeTime();
    updatePracticeTime();
  },
  showToast: (message) => showToast(message),
  setStatus: (text) => { statusText.textContent = text; },
});

function rememberCopyActive(value: boolean): void {
  try {
    if (value) localStorage.setItem(COPY_ACTIVE_KEY, "1");
    else localStorage.removeItem(COPY_ACTIVE_KEY);
  } catch { /* storage blocked: Copy just won't reopen by itself */ }
}

function readCopyActive(): boolean {
  try { return localStorage.getItem(COPY_ACTIVE_KEY) === "1"; } catch { return false; }
}

function enterCopy(): void {
  copyActive = true;
  modeSelect.value = "COPY";
  appShell.classList.add("copy-active");
  feedbackCard.hidden = true;
  copyView.show();
  updatePracticeTime();
  rememberCopyActive(true);
}

function leaveCopy(mode: PracticeMode): void {
  copyActive = false;
  copyView.hide();
  appShell.classList.remove("copy-active");
  rememberCopyActive(false);
  resizeCanvas();
  resetSession(mode);
}

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
let correctionGateEnabled = false;
let handedness: Handedness = DEFAULT_HANDEDNESS;
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
/** Accepted strokes of the current Box trial, in drawing order. */
let boxStrokes: RawStroke[] = [];
let boxTipsOpen = readBoxTipsOpen();
let lastAnalysis: AnalysisResult<PrimitiveMetrics> | null = null;
let sessionReps = 0;
let sessionStreak = 0;
let bestByExercise: Partial<Record<ExerciseType, number>> = {};
let savedStrokeCount = 0;
let savedTrialCount = 0;
let toastTimer: number | undefined;
let practiceClock = new PracticeClock({}, document.visibilityState === "visible");
let dailyTicks: ExerciseType[] = [...DEFAULT_DAILY_TICKS];
let dailyQueue: DailyQueueState | null = null;
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

/** Session and today's practice time, refreshed every second for display only (counting uses timestamps). */
function updatePracticeTime(): void {
  const now = Date.now();
  practiceTime.textContent = `${formatClock(practiceClock.sessionTotalMs(now))} · ${formatMinutes(practiceClock.todayTotalMs(now))} today`;
  if (copyActive) copyView.setTime(practiceTime.textContent);
}

let lastSavedPracticeMs = -1;

function persistPracticeTime(): void {
  const now = Date.now();
  lastSavedPracticeMs = practiceClock.todayTotalMs(now);
  void savePracticeTime(practiceClock.snapshot(now)).catch(() => undefined);
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

/** Taper strokes are drawn at their pressure-driven width (mm from pressure, so physical size, not screen px). */
function drawPressureStroke(stroke: RawStroke): void {
  const samples = stroke.samples;
  if (samples.length === 0) return;
  const px = cssPxPerMm();
  const widths = strokeWidthsMm(samples).map((width) => (width === null ? 2.2 : width * px));
  drawVariableWidthStroke(context, samples.map((sample) => ({ x: sample.xCss, y: sample.yCss })), widths);
}

/** Cue: a filled dot at the true wanted width, inside a faint ring so even a 0.5 mm dot can be found. */
function drawTaperCue(taper: TaperTarget): void {
  const px = cssPxPerMm();
  taperCheckpointsCss(taper).forEach((point, index) => {
    context.save();
    context.beginPath();
    context.arc(point.x, point.y, 11, 0, Math.PI * 2);
    context.strokeStyle = "rgba(23, 23, 23, 0.22)";
    context.lineWidth = 1;
    context.setLineDash([]);
    context.stroke();
    context.beginPath();
    context.arc(point.x, point.y, (targetWidthAtMm(taper, index / 2) * px) / 2, 0, Math.PI * 2);
    context.fillStyle = "#171717";
    context.fill();
    context.restore();
  });
}

function drawTaperOutline(taper: TaperTarget): void {
  const outline = taperOutlineCss(taper, cssPxPerMm());
  context.save();
  context.beginPath();
  context.moveTo(outline[0].x, outline[0].y);
  for (let index = 1; index < outline.length; index += 1) context.lineTo(outline[index].x, outline[index].y);
  context.strokeStyle = "#1557c0";
  context.lineWidth = 1.4;
  context.setLineDash([6, 4]);
  context.stroke();
  context.restore();
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

function singularLabel(type: ExerciseType): string {
  return type === "BOX" ? "box" : EXERCISE_LABELS[type].toLowerCase().replace(/s$/, "");
}

function strokeSegment(a: { x: number; y: number }, b: { x: number; y: number }): void {
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.stroke();
}

function drawHinge(corners: readonly { x: number; y: number }[], hingeEdgeIndex: number): void {
  const [a, b] = BOX_EDGES[hingeEdgeIndex];
  context.save();
  context.strokeStyle = BOX_ACCENT;
  context.lineWidth = 4;
  context.setLineDash([]);
  strokeSegment(corners[a], corners[b]);
  context.restore();
}

function drawBoxDivider(): void {
  const bounds = canvas.getBoundingClientRect();
  const { landscape } = boxAreas({ width: bounds.width, height: bounds.height });
  context.save();
  context.strokeStyle = "rgba(23, 23, 23, 0.1)";
  context.lineWidth = 1;
  context.setLineDash([]);
  if (landscape) strokeSegment({ x: bounds.width / 2, y: 24 }, { x: bounds.width / 2, y: bounds.height - 24 });
  else strokeSegment({ x: 24, y: bounds.height / 2 }, { x: bounds.width - 24, y: bounds.height / 2 });
  context.restore();
}

/**
 * The complete reference box (all 12 edges), its hinge, the swing arrow and the angle label.
 * Kept separate so a later "hide reference on first stroke" option only needs to skip this call.
 */
function fillFace(corners: readonly { x: number; y: number }[], faceIndex: number, color: string): void {
  const points = BOX_FACES[faceIndex].corners.map((corner) => corners[corner]);
  context.save();
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  context.restore();
}

function drawBoxReference(box: BoxTarget): void {
  const px = cssPxPerMm();
  const shading = boxShading(box);
  fillFace(box.referenceCornersCss, shading.faceIndex, BOX_FACE_SHADE);
  context.save();
  context.setLineDash([]);
  BOX_EDGES.forEach(([a, b], index) => {
    const hidden = shading.referenceHiddenEdges.includes(index);
    context.strokeStyle = hidden ? BOX_HIDDEN_EDGE : BOX_REFERENCE_GREY;
    context.lineWidth = hidden ? 1 : 1.3;
    strokeSegment(box.referenceCornersCss[a], box.referenceCornersCss[b]);
  });
  context.restore();
  drawHinge(box.referenceCornersCss, box.hingeEdgeIndex);

  drawSwingArrow(swingArrowCss(box, px), px);
  context.save();
  context.fillStyle = BOX_ACCENT;
  const label = arrowLabelCss(box, px);
  context.font = "600 15px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.strokeStyle = "rgba(255, 254, 250, 0.95)";
  context.lineWidth = 4;
  context.lineJoin = "round";
  context.strokeText(`${Math.abs(box.swingDeg)}°`, label.x, label.y);
  context.fillText(`${Math.abs(box.swingDeg)}°`, label.x, label.y);
  context.restore();
}

/**
 * Tail dot → curved shaft → large head, all over a paper-coloured halo so the arrow reads clearly even
 * where it crosses the reference box's grey edges.
 */
function drawSwingArrow(arrow: readonly { x: number; y: number }[], px: number): void {
  const tip = arrow.at(-1)!;
  const before = arrow.at(-4) ?? arrow[0];
  const heading = Math.atan2(tip.y - before.y, tip.x - before.x);
  const head = Math.max(11, 2.4 * px);
  // Stop the shaft inside the head so its round cap doesn't poke out of the point.
  const shaftEnd = { x: tip.x - Math.cos(heading) * head * 0.5, y: tip.y - Math.sin(heading) * head * 0.5 };
  const headPoints = [
    { x: tip.x + Math.cos(heading) * head * 0.25, y: tip.y + Math.sin(heading) * head * 0.25 },
    { x: tip.x + Math.cos(heading + 2.65) * head, y: tip.y + Math.sin(heading + 2.65) * head },
    { x: tip.x + Math.cos(heading - 2.65) * head, y: tip.y + Math.sin(heading - 2.65) * head },
  ];
  const tracePath = (): void => {
    context.beginPath();
    context.moveTo(arrow[0].x, arrow[0].y);
    for (let index = 1; index < arrow.length - 1; index += 1) context.lineTo(arrow[index].x, arrow[index].y);
    context.lineTo(shaftEnd.x, shaftEnd.y);
  };
  const traceHead = (): void => {
    context.beginPath();
    context.moveTo(headPoints[0].x, headPoints[0].y);
    context.lineTo(headPoints[1].x, headPoints[1].y);
    context.lineTo(headPoints[2].x, headPoints[2].y);
    context.closePath();
  };
  const tailRadius = 3.2;
  context.save();
  context.setLineDash([]);
  context.lineCap = "round";
  context.lineJoin = "round";
  // Halo.
  context.strokeStyle = "rgba(255, 254, 250, 0.95)";
  context.fillStyle = "rgba(255, 254, 250, 0.95)";
  context.lineWidth = 8;
  tracePath();
  context.stroke();
  traceHead();
  context.stroke();
  context.beginPath();
  context.arc(arrow[0].x, arrow[0].y, tailRadius + 3, 0, Math.PI * 2);
  context.fill();
  // Arrow.
  context.strokeStyle = BOX_ACCENT;
  context.fillStyle = BOX_ACCENT;
  context.lineWidth = 2.6;
  tracePath();
  context.stroke();
  traceHead();
  context.fill();
  context.beginPath();
  context.arc(arrow[0].x, arrow[0].y, tailRadius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawBoxAnswer(box: BoxTarget): void {
  context.save();
  context.strokeStyle = "#1557c0";
  context.lineWidth = 2;
  context.setLineDash([8, 6]);
  for (const index of nonHingeEdgeIndices(box.hingeEdgeIndex)) {
    const [a, b] = BOX_EDGES[index];
    strokeSegment(box.answerCornersCss[a], box.answerCornersCss[b]);
  }
  context.restore();
}

function drawBoxTrial(box: BoxTarget): void {
  drawBoxDivider();
  drawBoxReference(box);
  if (trialState === "FEEDBACK") {
    // The same physical face as in the reference, under the strokes so they stay readable.
    const shading = boxShading(box);
    fillFace(box.answerCornersCss, shading.faceIndex, shading.answerFaceVisible ? BOX_ANSWER_FACE_SHADE : BOX_ANSWER_FACE_SHADE_AWAY);
  }
  for (const stroke of boxStrokes) drawRawStroke(stroke);
  if (activeStroke) drawRawStroke(activeStroke);
  if (trialState === "FEEDBACK") drawBoxAnswer(box);
  drawHinge(box.answerCornersCss, box.hingeEdgeIndex);
}

function boxProgressText(): string {
  const box = `${EXERCISE_LABELS.BOX.replace(/es$/, "")} · ${boxStrokes.length}/${BOX_STROKES_REQUIRED}`;
  return selectedMode === "TODAY" && dailyQueue ? `${box} · ${queueRemaining(dailyQueue)} left today` : box;
}

/* ---------- Today's queue ---------- */

/** Today's queue, rebuilt (and saved) when the practice day has changed since it was made. */
function todayQueue(): DailyQueueState {
  const next = ensureTodayQueue(dailyQueue, dailyTicks, Date.now());
  if (next !== dailyQueue) {
    dailyQueue = next;
    void saveDailyQueue(next).catch(() => undefined);
  }
  return next;
}

function todayStatusText(queue: DailyQueueState): string {
  return `Today · ${queueRemaining(queue)} left · about ${queueMinutesLeft(queue)} min`;
}

/** Shown instead of a target when today's queue is finished or nothing is ticked. */
function showDoneCard(queue: DailyQueueState): void {
  target = null;
  trialState = "PREPARING";
  feedbackCard.hidden = true;
  emptyState.classList.add("hidden");
  undoStrokeButton.hidden = true;
  boxTipsButton.hidden = true;
  boxTipsPanel.hidden = true;
  const empty = queue.order.length === 0;
  doneTitle.textContent = empty ? "Nothing ticked for Today" : "Done for today ✓";
  doneDetail.textContent = empty
    ? "Choose which modes make up the daily queue."
    : `${queue.order.length} reps · ${formatMinutes(practiceClock.todayTotalMs(Date.now()))} practised today`;
  doneNote.textContent = empty
    ? "Today's queue is built from the ticked modes."
    : "Pick any mode above for free practice. It doesn't count toward the queue; a new one starts at 4 am.";
  doneSettingsButton.hidden = !empty;
  doneCard.hidden = false;
  statusText.textContent = empty ? "Today · nothing ticked" : "Today · done ✓";
  redrawAll();
}

/** Every saved attempt moves the schedule on: the queue in Today, the scheduler otherwise. */
function advanceSchedule(): void {
  if (selectedMode !== "TODAY") {
    scheduler.advance();
    return;
  }
  dailyQueue = advanceQueue(todayQueue());
  void saveDailyQueue(dailyQueue).catch(() => showToast("Today's progress could not be saved"));
}

function scheduleContext() {
  const generationIndex = targetGenerationIndex - 1;
  if (selectedMode !== "TODAY" || !dailyQueue) return { ...scheduler.context(), generationIndex };
  return { mode: "TODAY" as const, sessionSeed: `daily:${dailyQueue.dayKey}`, sequenceIndex: dailyQueue.position, cycleIndex: 0, generationIndex };
}

/** The 4 am rollover while the page is open: start the new day's queue unless a trial is in progress. */
function checkDayRollover(): void {
  if (selectedMode !== "TODAY" || !dailyQueue || dailyQueue.dayKey === dayKey(Date.now())) return;
  const midTrial = trialState === "DRAWING" || trialState === "PROCESSING" || (trialState === "READY" && boxStrokes.length > 0);
  if (!midTrial) beginNewTrial();
}

function renderDailyTicks(): void {
  dailyTicksList.replaceChildren(...ALL_EXERCISE_TYPES.map((type) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = dailyTicks.includes(type);
    input.addEventListener("change", () => void setDailyTick(type, input.checked));
    const name = document.createElement("span");
    name.textContent = EXERCISE_LABELS[type];
    const count = document.createElement("small");
    count.textContent = `${DAILY_COUNTS[type]}`;
    label.append(input, name, count);
    return label;
  }));
  dailyEstimate.textContent = dailyTicks.length === 0 ? "Nothing ticked: Today will be empty." : `About ${dailyMinutes(dailyTicks)} min a day.`;
}

async function setDailyTick(type: ExerciseType, ticked: boolean): Promise<void> {
  dailyTicks = ALL_EXERCISE_TYPES.filter((each) => (each === type ? ticked : dailyTicks.includes(each)));
  renderDailyTicks();
  void saveDailyTicks(dailyTicks).catch(() => showToast("Today's ticks could not be saved"));
  const wasEmpty = !dailyQueue || dailyQueue.order.length === 0;
  if (wasEmpty) {
    todayQueue();
    if (selectedMode === "TODAY" && trialState !== "DRAWING") beginNewTrial();
  } else {
    showToast("Applies from tomorrow's queue");
  }
}

/** Device-local convenience only, so plain localStorage (guarded) rather than IndexedDB. */
function readBoxTipsOpen(): boolean {
  try { return window.localStorage.getItem(BOX_TIPS_OPEN_KEY) === "1"; } catch { return false; }
}

function updateBoxTips(): void {
  const boxMode = activeExercise === "BOX";
  boxTipsButton.hidden = !boxMode;
  boxTipsButton.setAttribute("aria-pressed", String(boxTipsOpen));
  boxTipsPanel.hidden = !boxMode || !boxTipsOpen;
}

function setBoxTipsOpen(open: boolean): void {
  boxTipsOpen = open;
  try { window.localStorage.setItem(BOX_TIPS_OPEN_KEY, open ? "1" : "0"); } catch { /* Private mode: just don't remember. */ }
  updateBoxTips();
}

function updateUndoButton(): void {
  const boxDrawing = activeExercise === "BOX" && (trialState === "READY" || trialState === "DRAWING");
  undoStrokeButton.hidden = !boxDrawing;
  undoStrokeButton.disabled = !boxDrawing || trialState !== "READY" || boxStrokes.length === 0;
}

function undoBoxStroke(): void {
  if (activeExercise !== "BOX" || trialState !== "READY" || boxStrokes.length === 0) return;
  boxStrokes.pop();
  completedStroke = boxStrokes.at(-1) ?? null;
  statusText.textContent = boxProgressText();
  updateUndoButton();
  redrawAll();
}

function redrawAll(): void {
  const bounds = canvas.getBoundingClientRect();
  context.clearRect(0, 0, bounds.width, bounds.height);
  if (!target) return;
  if (target.kind === "BOX") {
    drawBoxTrial(target);
    return;
  }
  if (target.kind === "TAPER") {
    // Cue first so the stroke covers it; the outline goes on top after lift.
    drawTaperCue(target);
    const stroke = activeStroke ?? completedStroke;
    if (stroke) drawPressureStroke(stroke);
    if (trialState === "FEEDBACK") drawTaperOutline(target);
    return;
  }
  if (activeStroke) drawRawStroke(activeStroke);
  else if (completedStroke) drawRawStroke(completedStroke);
  if (trialState === "FEEDBACK") drawIdealTarget(target);
  targetCheckpointsCss(target, cssPxPerMm()).forEach(drawLandmark);
}

function statusForCurrentTrial(): string {
  if (activeExercise === "BOX") return boxProgressText();
  if (selectedMode === "TODAY" && dailyQueue) return todayStatusText(dailyQueue);
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

/** Overlays (feedback card, tips) sit on the side away from the drawing hand; Box layout reads the same setting. */
function applyHandedness(): void {
  drawingStage.dataset.hand = handedness.toLowerCase();
  for (const button of handButtons) button.setAttribute("aria-pressed", String(button.dataset.hand === handedness));
}

function setHandedness(next: Handedness): void {
  if (next === handedness) return;
  handedness = next;
  applyHandedness();
  copyView.setHandedness();
  void saveHandedness(next).catch(() => showToast("Hand setting could not be saved"));
  // Re-lay out a Box that has not been started; a box in progress keeps its layout until the next one.
  if (activeExercise === "BOX" && trialState === "READY" && boxStrokes.length === 0) beginNewTrial();
  else if (activeExercise === "BOX") showToast("Applies from the next box");
}

function updateCorrectionGateButton(): void {
  for (const button of correctionButtons) button.setAttribute("aria-pressed", String((button.dataset.corrections === "on") === correctionGateEnabled));
}

function beginNewTrial(): void {
  trialState = "PREPARING";
  activePointerId = null;
  activeStroke = null;
  activeSampleKeys = new Set<string>();
  completedStroke = null;
  boxStrokes = [];
  lastAnalysis = null;
  feedbackCard.hidden = true;
  feedbackCard.classList.remove("failed");
  if (selectedMode === "TODAY") {
    const queue = todayQueue();
    const next = currentQueueExercise(queue);
    if (!next) {
      showDoneCard(queue);
      return;
    }
    activeExercise = next;
  } else {
    activeExercise = scheduler.currentExercise();
  }
  doneCard.hidden = true;
  const bounds = canvas.getBoundingClientRect();
  target = generateTarget(
    activeExercise,
    { width: bounds.width, height: bounds.height },
    cssPxPerMm(),
    scheduler.sessionSeed,
    targetGenerationIndex,
    handedness,
  );
  targetGenerationIndex += 1;
  const instruction = INSTRUCTIONS[activeExercise];
  instructionType.textContent = instruction.kicker;
  instructionText.textContent = instruction.prompt;
  instructionNote.textContent = activeExercise === "BOX"
    ? "The true box appears in blue after the 11th edge."
    : activeExercise === "TAPER" ? "The ideal outline appears in blue after you lift the Pencil." : DEFAULT_INSTRUCTION_NOTE;
  emptyState.classList.toggle("compact", activeExercise === "BOX" || activeExercise === "TAPER");
  nextTrialButton.textContent = `Next ${singularLabel(activeExercise)}`;
  trialState = "READY";
  statusText.textContent = statusForCurrentTrial();
  updateUndoButton();
  updateBoxTips();
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
  practiceClock.recordActivity(Date.now());
  emptyState.classList.add("hidden");
  statusText.textContent = activeExercise === "BOX" ? boxProgressText() : `${EXERCISE_LABELS[activeExercise]} · commit to the movement`;
  updateUndoButton();
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

function boxFeedbackDetail(metrics: BoxMetrics): string {
  const target = Math.abs(metrics.targetSwingDeg);
  const fitted = Math.round(Math.abs(metrics.fittedSwingDeg));
  const edges = `edges ${metrics.rmsOrthogonalDeviationMm.toFixed(1)} mm`;
  const wrongWay = fitted >= 1 && Math.sign(metrics.fittedSwingDeg) !== Math.sign(metrics.targetSwingDeg);
  return wrongWay
    ? `You swung it the wrong way (${fitted}°) · target ${target}° · ${edges}`
    : `You turned it ${fitted}° · target ${target}° · ${edges}`;
}

function feedbackDetails(analysis: AnalysisResult): string {
  const metrics = analysis.metrics;
  if ("fittedSwingDeg" in metrics) return boxFeedbackDetail(metrics);
  if ("widthRmsErrorMm" in metrics) return taperMetricText(metrics);
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
    feedbackResult.textContent = `Committed ${singularLabel(activeExercise)} ✓`;
    feedbackScore.textContent = `Accuracy ${analysis.accuracyScore ?? 0}`;
    feedbackDetail.textContent = feedbackDetails(analysis);
    statusText.textContent = activeExercise === "BOX" ? "Feedback shown — true box in blue" : "Feedback shown — ideal path in blue";
  } else {
    feedbackCard.classList.add("failed");
    feedbackResult.textContent = "Execution not scored";
    feedbackScore.textContent = analysis.executionReason ?? "Try another one";
    feedbackDetail.textContent = correctionGateEnabled
      ? "Accuracy is hidden when the movement is incomplete or too corrective."
      : "Accuracy is hidden when the movement is incomplete or implausible.";
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
  practiceClock.recordActivity(Date.now());
  persistPracticeTime();
  updatePracticeTime();
  activeStroke = null;
  activePointerId = null;

  if (target.kind === "BOX") {
    await finishBoxStroke(stroke, target);
    return;
  }

  if (cancelled) {
    try { await saveStroke(stroke); savedStrokeCount += 1; } catch { showToast("Interrupted stroke could not be saved"); }
    beginNewTrial();
    return;
  }

  try {
    const analysis = analyseTargetStroke(stroke, target, cssPxPerMm(), correctionGateEnabled);
    lastAnalysis = analysis;
    const versions = versionsForExercise(activeExercise);
    const schedule = scheduleContext();
    const trial: SingleStrokeTrialRecord = {
      id: createId(),
      appVersion: APP_VERSION,
      metricVersion: versions.metric,
      scoringVersion: versions.scoring,
      createdAtEpochMs: Date.now(),
      exerciseType: activeExercise as SingleStrokeExerciseType,
      practiceMode: selectedMode,
      correctionGateEnabled,
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
    advanceSchedule();
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

function showEvaluationFailure(): void {
  trialState = "FEEDBACK";
  feedbackCard.hidden = false;
  feedbackCard.classList.add("failed");
  feedbackResult.textContent = "Couldn’t evaluate this stroke";
  feedbackScore.textContent = "Try another one";
  feedbackDetail.textContent = "The raw stroke was kept for diagnostics.";
  statusText.textContent = "Evaluation failed — raw stroke preserved";
  updateUndoButton();
  redrawAll();
}

function returnToBoxDrawing(message?: string): void {
  trialState = "READY";
  if (message) showToast(message);
  statusText.textContent = boxProgressText();
  updateUndoButton();
  redrawAll();
}

/** One Box stroke has ended: drop it, keep it, or (on the 11th) score the whole box. */
async function finishBoxStroke(stroke: RawStroke, box: BoxTarget): Promise<void> {
  if (stroke.cancelled) {
    void saveStroke(stroke).then(() => { savedStrokeCount += 1; }, () => undefined);
    returnToBoxDrawing("Stroke interrupted — not counted");
    return;
  }
  const px = cssPxPerMm();
  const pathMm = polylineLength(stroke.samples.map((sample) => ({ x: sample.xCss / px, y: sample.yCss / px })));
  if (stroke.samples.length < BOX_MIN_STROKE_SAMPLES || pathMm < BOX_MIN_STROKE_PATH_MM) {
    returnToBoxDrawing("Too short — not counted");
    return;
  }
  boxStrokes.push(stroke);
  if (boxStrokes.length < BOX_STROKES_REQUIRED) {
    returnToBoxDrawing();
    return;
  }
  await submitBoxTrial(box);
}

async function submitBoxTrial(box: BoxTarget): Promise<void> {
  trialState = "PROCESSING";
  updateUndoButton();
  statusText.textContent = boxProgressText();
  const strokes = [...boxStrokes];
  try {
    const analysis = analyseBoxStrokes(strokes, box, cssPxPerMm());
    lastAnalysis = analysis;
    const versions = versionsForExercise("BOX");
    const trial: BoxTrialRecord = {
      id: createId(),
      appVersion: APP_VERSION,
      metricVersion: versions.metric,
      scoringVersion: versions.scoring,
      createdAtEpochMs: Date.now(),
      exerciseType: "BOX",
      practiceMode: selectedMode,
      correctionGateEnabled: false,
      schedule: scheduleContext(),
      target: box,
      rawStrokes: strokes,
      calibrationId: calibration?.id ?? null,
      derived: analysis,
    };
    await Promise.all([...strokes.map(saveStroke), saveTrial(trial)]);
    savedStrokeCount += strokes.length;
    savedTrialCount += 1;
    updatePracticeHud(analysis);
    advanceSchedule();
    trialState = "FEEDBACK";
    showFeedback(analysis);
    redrawAll();
  } catch {
    showEvaluationFailure();
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
    "Correction gate": correctionGateEnabled ? "On" : "Off",
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
    "Drawing hand": handedness === "LEFT" ? "Left" : "Right",
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
      selectedMode, correctionGateEnabled, device: getDeviceSnapshot(), strokes, trials,
      practiceTimeByDay: practiceClock.snapshot(Date.now()),
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
      : `${trials.length.toLocaleString()} trials saved · ${counts.LINE} lines · ${counts.ARC} arcs · ${counts.CIRCLE} circles · ${counts.ELLIPSE} ellipses · ${counts.S_CURVE} S curves · ${counts.BOX} boxes.`;
  } catch { dataSummary.textContent = "Saved data could not be read in this browser."; }
  dataDialog.showModal();
}

/**
 * Trials store their calibration id but not its px/mm value. Use the current calibration when it is the one
 * the trial was drawn with, the default scale for uncalibrated trials, and otherwise the current scale as the
 * best available guess (only mm-sized targets such as circles depend on it).
 */
function trialCssPxPerMm(trial: TrialRecord): number {
  if (trial.calibrationId === null) return DEFAULT_CSS_PX_PER_MM;
  return cssPxPerMm();
}

async function showTrophyDialog(): Promise<void> {
  let trials: TrialRecord[] = [];
  try {
    trials = await getTrials();
    trophyIntro.textContent = "Your highest-scoring attempt at each exercise: your strokes in black, the ideal in dashed blue. Tap one to see it larger.";
  } catch {
    trophyIntro.textContent = "Saved trials could not be read in this browser.";
  }
  trophyDialog.showModal();
  trophyView.render(bestTrialsByExercise(trials));
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
  for (const button of correctionButtons) button.addEventListener("click", () => {
    const enabled = button.dataset.corrections === "on";
    if (enabled === correctionGateEnabled) return;
    correctionGateEnabled = enabled;
    updateCorrectionGateButton();
    showToast(`Correction rejection ${correctionGateEnabled ? "on" : "off"}`);
    void saveCorrectionGateEnabled(correctionGateEnabled).catch(() => showToast("Correction setting could not be saved"));
  });
  nextTrialButton.addEventListener("click", beginNewTrial);
  undoStrokeButton.addEventListener("click", undoBoxStroke);
  boxTipsButton.addEventListener("click", () => setBoxTipsOpen(!boxTipsOpen));
  requiredElement<HTMLButtonElement>("#closeBoxTipsButton").addEventListener("click", () => setBoxTipsOpen(false));
  modeSelect.addEventListener("change", () => {
    if (copyActive && copyView.isDrawing()) {
      modeSelect.value = "COPY";
      showToast("Finish the current stroke before changing modes");
      return;
    }
    // Copy is handled before any practice-mode logic: it has no trials.
    if (modeSelect.value === "COPY") {
      if (trialState === "DRAWING") {
        modeSelect.value = selectedMode;
        showToast("Finish the current stroke before changing modes");
        return;
      }
      enterCopy();
      return;
    }
    const mode = modeSelect.value as PracticeMode;
    if (!VALID_MODES.includes(mode) || trialState === "DRAWING") {
      modeSelect.value = copyActive ? "COPY" : selectedMode;
      if (trialState === "DRAWING") showToast("Finish the current stroke before changing modes");
      return;
    }
    if (copyActive) leaveCopy(mode);
    else resetSession(mode);
    void savePracticeMode(mode).catch(() => showToast("Practice mode could not be saved"));
  });
  requiredElement<HTMLButtonElement>("#settingsButton").addEventListener("click", () => { configureRuler(); renderDailyTicks(); calibrationDialog.showModal(); });
  // Diagnostics and practice data open from Settings, replacing it rather than stacking on top.
  requiredElement<HTMLButtonElement>("#diagnosticsButton").addEventListener("click", () => { calibrationDialog.close(); renderDiagnostics(); diagnosticsDialog.showModal(); });
  requiredElement<HTMLButtonElement>("#dataButton").addEventListener("click", () => { calibrationDialog.close(); void showDataDialog(); });
  requiredElement<HTMLButtonElement>("#trophiesButton").addEventListener("click", () => void showTrophyDialog());
  requiredElement<HTMLButtonElement>("#trophyBackButton").addEventListener("click", () => trophyView.showGrid());
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
  for (const button of handButtons) button.addEventListener("click", () => setHandedness(button.dataset.hand === "RIGHT" ? "RIGHT" : "LEFT"));
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", (event) => void finishStroke(event, false));
  canvas.addEventListener("pointercancel", (event) => void finishStroke(event, true));
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("resize", () => {
    if (copyActive) return; // The Copy view lays itself out.
    resizeCanvas();
    if (trialState !== "DRAWING") beginNewTrial();
  });
  document.addEventListener("visibilitychange", () => {
    const visible = document.visibilityState === "visible";
    practiceClock.setVisible(visible, Date.now());
    if (visible) checkDayRollover();
    if (!visible) persistPracticeTime();
    updatePracticeTime();
  });
  window.addEventListener("pagehide", persistPracticeTime);
  doneSettingsButton.addEventListener("click", () => { configureRuler(); renderDailyTicks(); calibrationDialog.showModal(); });
  window.setInterval(() => { if (document.visibilityState === "visible") updatePracticeTime(); }, 1000);
  // Saving on pagehide is not reliable (the write may not finish), so also save while time is accruing.
  window.setInterval(() => { if (practiceClock.todayTotalMs(Date.now()) !== lastSavedPracticeMs) persistPracticeTime(); }, 10_000);
}

async function initialize(): Promise<void> {
  wireControls();
  resizeCanvas();
  try {
    const [storedCalibration, storedMode, storedCorrectionGate, storedHandedness, storedPracticeTime, storedTicks, storedQueue, strokes, trials] = await Promise.all([
      getCalibration(), getPracticeMode(), getCorrectionGateEnabled(), getHandedness(), getPracticeTime(), getDailyTicks(), getDailyQueue(), getStrokes(), getTrials(),
    ]);
    dailyTicks = storedTicks ?? [...DEFAULT_DAILY_TICKS];
    dailyQueue = storedQueue;
    practiceClock = new PracticeClock(storedPracticeTime ?? {}, document.visibilityState === "visible");
    calibration = storedCalibration;
    handedness = storedHandedness ?? DEFAULT_HANDEDNESS;
    correctionGateEnabled = storedCorrectionGate ?? false;
    selectedMode = storedMode && VALID_MODES.includes(storedMode) ? storedMode : "LINE";
    // Open on Today while today's queue has reps left.
    const queue = todayQueue();
    if (queue.order.length > 0 && !isQueueDone(queue)) selectedMode = "TODAY";
    savedStrokeCount = strokes.length;
    savedTrialCount = trials.length;
    for (const trial of trials) {
      introducedExercises.add(trial.exerciseType);
      const value = trial.derived.accuracyScore;
      if (value !== undefined) bestByExercise[trial.exerciseType] = Math.max(bestByExercise[trial.exerciseType] ?? 0, value);
    }
  } catch { showToast("Local storage is unavailable; drawing still works"); }
  updateScaleStatus();
  updateCorrectionGateButton();
  applyHandedness();
  configureRuler();
  resetSession(selectedMode);
  if (readCopyActive()) enterCopy();
  updatePracticeTime();
  if (new URLSearchParams(window.location.search).has("diagnostics") || window.location.hash === "#diagnostics") {
    renderDiagnostics();
    diagnosticsDialog.showModal();
  }
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => { void navigator.serviceWorker.register("./service-worker.js").catch(() => undefined); });
  }
}

void initialize();
