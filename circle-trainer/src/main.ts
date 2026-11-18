import "./styles.css";

import { ALL_EXERCISE_TYPES, drillFor, versionsForExercise } from "./activities/drills/registry";
import type { Drill } from "./activities/drills/types";
import { duplicateStrokeIds, looseStrokes, oldLooseStrokeIds, pruneTrial, RAW_SAMPLE_DAYS, strokeIdsInTrials, trialSampleCount, trialsToPrune } from "./core/retention";
import { actionAfterResize, backingOutOfDate, shiftStroke, type CanvasBox } from "./core/canvasSize";
import { rawSampleIdentity } from "./core/input";
import { isTap, type TapPoint } from "./core/tap";
import { bestTrialsByExercise } from "./core/trophies";
import { EXERCISE_LABELS, MODE_LABELS, PracticeScheduler } from "./core/scheduler";
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
import { DEFAULT_HANDEDNESS, type Handedness } from "./core/types";
import {
  clearStrokes,
  clearTrials,
  getCalibration,
  getCorrectionGateEnabled,
  getCopyBudget,
  getCopyTime,
  getDailyQueue,
  getDailyTicks,
  getDayMarks,
  getFinishedDays,
  getLastExport,
  getPrunedTotals,
  deleteStrokes,
  savePrunedTotals,
  saveTrials,
  getHandedness,
  getPracticeTime,
  getPracticeMode,
  getStrokes,
  getTrials,
  saveCalibration,
  saveCopyBudget,
  saveCopyTime,
  saveCorrectionGateEnabled,
  saveDailyQueue,
  saveDailyTicks,
  saveDayMarks,
  saveFinishedDays,
  saveLastExport,
  saveHandedness,
  savePracticeTime,
  savePracticeMode,
  saveStroke,
  saveTrial,
} from "./storage";
import { backupReminder } from "./core/backup";
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
  queueProgress,
  queueRemaining,
  requeueForTicks,
  type DailyQueueState,
} from "./core/dailyQueue";
import {
  copyCardAtCheckpoint,
  addFinishedDay,
  copyClockState,
  dayFinished,
  lastSevenDays,
  copyLeftMs,
  copyTimeText,
  DEFAULT_COPY_BUDGET_MIN,
  drillMs,
  marksForToday,
  todayCard,
  type CopyCard,
  type DayInput,
  type DayMarks,
  startupMode,
} from "./core/dailyFlow";

const APP_VERSION = "0.16.0";
const SCHEMA_VERSION = "4" as const;
const DEFAULT_CSS_PX_PER_MM = 96 / 25.4;
const DEFAULT_RULER_WIDTH_CSS_PX = 378;
const VALID_MODES: readonly PracticeMode[] = [...ALL_EXERCISE_TYPES, "MIXED_BLOCKED", "MIXED_RANDOM", "TODAY"];
/** The first drill in the menu: where a fresh install starts. */
const FIRST_DRILL = ALL_EXERCISE_TYPES[0];

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
const doneWeekDots = requiredElement<HTMLElement>("#doneWeekDots");
const doneSettingsButton = requiredElement<HTMLButtonElement>("#doneSettingsButton");
const doneCopyButton = requiredElement<HTMLButtonElement>("#doneCopyButton");
const doneFinishButton = requiredElement<HTMLButtonElement>("#doneFinishButton");
const copyBudgetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#copyBudgetSetting button[data-copy-budget]"));
const dayDoneDialog = requiredElement<HTMLDialogElement>("#dayDoneDialog");
const dayDoneTitle = requiredElement<HTMLElement>("#dayDoneTitle");
const dayDoneDetail = requiredElement<HTMLElement>("#dayDoneDetail");
const dayDoneWeekDots = requiredElement<HTMLElement>("#dayDoneWeekDots");
const doneBackup = requiredElement<HTMLElement>("#doneBackup");
const dayDoneBackup = requiredElement<HTMLElement>("#dayDoneBackup");
const dayDoneTodayButton = requiredElement<HTMLButtonElement>("#dayDoneTodayButton");
const dailyTicksList = requiredElement<HTMLElement>("#dailyTicks");
const dailyEstimate = requiredElement<HTMLElement>("#dailyEstimate");
const bestScore = requiredElement<HTMLElement>("#bestScore");
const feedbackCard = requiredElement<HTMLElement>("#feedbackCard");
const feedbackResult = requiredElement<HTMLElement>("#feedbackResult");
const feedbackScore = requiredElement<HTMLElement>("#feedbackScore");
const feedbackDetail = requiredElement<HTMLElement>("#feedbackDetail");
const modeSelect = requiredElement<HTMLSelectElement>("#practiceModeSelect");
const todayModeButton = requiredElement<HTMLButtonElement>("#todayModeButton");
const copyModeButton = requiredElement<HTMLButtonElement>("#copyModeButton");
const correctionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#correctionGateSetting button[data-corrections]"));
const nextTrialButton = requiredElement<HTMLButtonElement>("#nextTrialButton");
const undoStrokeButton = requiredElement<HTMLButtonElement>("#undoStrokeButton");
/** A drill's Tips button and panel (Box has them; the ids and the stored key keep their names). */
const tipsButton = requiredElement<HTMLButtonElement>("#boxTipsButton");
const tipsPanel = requiredElement<HTMLElement>("#boxTipsPanel");
const TIPS_OPEN_KEY = "circle-trainer:box-tips-open";
const toast = requiredElement<HTMLElement>("#toast");

const calibrationDialog = requiredElement<HTMLDialogElement>("#calibrationDialog");
const handButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".hand-setting button[data-hand]"));
const drawingStage = requiredElement<HTMLElement>(".drawing-stage");
const hud = requiredElement<HTMLElement>(".hud");
const todayHud = requiredElement<HTMLElement>(".hud-today");
const todayProgress = requiredElement<HTMLElement>("#todayProgress");
const todayProgressFill = requiredElement<HTMLElement>("#todayProgressFill");
const todayLeft = requiredElement<HTMLElement>("#todayLeft");
const rulerLine = requiredElement<HTMLElement>("#rulerLine");
const rulerSlider = requiredElement<HTMLInputElement>("#rulerSlider");
const rulerOutput = requiredElement<HTMLOutputElement>("#rulerOutput");
const diagnosticsDialog = requiredElement<HTMLDialogElement>("#diagnosticsDialog");
const diagnosticGrid = requiredElement<HTMLElement>("#diagnosticGrid");
const dataDialog = requiredElement<HTMLDialogElement>("#dataDialog");
const dataSummary = requiredElement<HTMLElement>("#dataSummary");
const dataRetention = requiredElement<HTMLElement>("#dataRetention");
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
/** Practice day a mode was last picked from the menu, so a same-day reload keeps a free mode instead of jumping to Today. */
const MODE_DAY_KEY = "circle-trainer:mode-day";

function rememberModeDay(): void {
  try { localStorage.setItem(MODE_DAY_KEY, dayKey(Date.now())); } catch { /* storage blocked: reloads open on Today */ }
}

function readModeDay(): string | null {
  try { return localStorage.getItem(MODE_DAY_KEY); } catch { return null; }
}
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
  saveOverlayButton: requiredElement<HTMLButtonElement>("#copySaveOverlayButton"),
  saveNote: requiredElement<HTMLElement>("#copySaveNote"),
  savePreview: requiredElement<HTMLElement>("#copySavePreview"),
  savePreviewImage: requiredElement<HTMLImageElement>("#copySavePreviewImage"),
  saveDownloadLink: requiredElement<HTMLAnchorElement>("#copySaveDownloadLink"),
  pageButton: requiredElement<HTMLButtonElement>("#copyPageButton"),
  libraryButton: requiredElement<HTMLButtonElement>("#copyLibraryButton"),
  libraryDialog: requiredElement<HTMLDialogElement>("#copyLibraryDialog"),
  libraryList: requiredElement<HTMLElement>("#copyLibraryList"),
  libraryNote: requiredElement<HTMLElement>("#copyLibraryNote"),
  memorySelect: requiredElement<HTMLSelectElement>("#copyMemorySelect"),
  memoryBar: requiredElement<HTMLElement>("#copyMemoryBar"),
  memoryText: requiredElement<HTMLElement>("#copyMemoryText"),
  memoryStartButton: requiredElement<HTMLButtonElement>("#copyMemoryStartButton"),
  memoryPeekButton: requiredElement<HTMLButtonElement>("#copyMemoryPeekButton"),
}, {
  pxPerMm: () => cssPxPerMm(),
  handedness: () => handedness,
  onActivity: (ended) => {
    const now = Date.now();
    practiceClock.recordActivity(now);
    copyClock.recordActivity(now);
    if (ended) persistPracticeTime();
    updatePracticeTime();
  },
  // Moving or zooming the reference is part of copying. Recording activity is only arithmetic, so it can run per move.
  onGesture: () => {
    const now = Date.now();
    practiceClock.recordActivity(now);
    copyClock.recordActivity(now);
  },
  onCheckpoint: () => copyCheckpoint(),
  showToast: (message) => showToast(message),
  setStatus: (text) => { statusText.textContent = text; },
});

/** Stores the practice day Copy was open on, so a reload reopens Copy that day but a new day opens on Today. */
function rememberCopyActive(value: boolean): void {
  try {
    if (value) localStorage.setItem(COPY_ACTIVE_KEY, dayKey(Date.now()));
    else localStorage.removeItem(COPY_ACTIVE_KEY);
  } catch { /* storage blocked: Copy just won't reopen by itself */ }
}

/** Copy was open when the page was last left. "today" when that was today (older versions stored "1"). */
function readCopyActive(): "today" | "earlier" | null {
  try {
    const value = localStorage.getItem(COPY_ACTIVE_KEY);
    return value === null ? null : value === dayKey(Date.now()) ? "today" : "earlier";
  } catch { return null; }
}

function enterCopy(): void {
  copyActive = true;
  showModeChoice("COPY");
  appShell.classList.add("copy-active");
  feedbackCard.hidden = true;
  copyView.show();
  copyClock.setVisible(document.visibilityState === "visible", Date.now());
  updatePracticeTime();
  rememberCopyActive(true);
}

function leaveCopy(mode: PracticeMode): void {
  copyActive = false;
  copyClock.setVisible(false, Date.now());
  persistPracticeTime();
  if (dayDoneDialog.open) dayDoneDialog.close();
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
let selectedMode: PracticeMode = FIRST_DRILL;
let scheduler = new PracticeScheduler(FIRST_DRILL, createId());
let targetGenerationIndex = 0;
let activeExercise: ExerciseType = FIRST_DRILL;
let trialState: TrialState = "PREPARING";
let target: TargetDefinition | null = null;
let activePointerId: number | null = null;
/**
 * A Pencil or finger touch on the canvas during feedback, followed until it lifts to see whether it
 * was a tap. `spoiled` is set when another contact lands meanwhile (a palm, a pinch): then it is not a tap.
 */
let feedbackTap: { pointerId: number; pen: boolean; spoiled: boolean; points: TapPoint[] } | null = null;
let activeStroke: RawStroke | null = null;
let activeSampleKeys = new Set<string>();
let completedStroke: RawStroke | null = null;
/** Accepted strokes of the current trial, in drawing order (the finished one, for a one-stroke drill). */
let trialStrokes: RawStroke[] = [];
/** The canvas size (CSS px) and drawing hand the current target was laid out for. */
let targetCanvas: CanvasBox | null = null;
let targetHandedness: Handedness = DEFAULT_HANDEDNESS;
/** Times the size watcher found the canvas's pixel size out of date (shown in Diagnostics). */
let lateCanvasResizes = 0;
let tipsOpen = readTipsOpen();
let lastAnalysis: AnalysisResult<PrimitiveMetrics> | null = null;
let sessionReps = 0;
let sessionStreak = 0;
let bestByExercise: Partial<Record<ExerciseType, number>> = {};
let savedStrokeCount = 0;
let savedTrialCount = 0;
let toastTimer: number | undefined;
let practiceClock = new PracticeClock({}, document.visibilityState === "visible");
/** Copy time only: runs while Copy is open and the page is visible, with the practice clock's idle rule. */
let copyClock = new PracticeClock({}, false);
let copyBudgetMin = DEFAULT_COPY_BUDGET_MIN;
let dayMarks: DayMarks | null = null;
/** Days whose flow was finished (sorted day keys), shown as the seven-dot row on the Done cards. */
let finishedDays: string[] = [];
/** Set once stored settings have loaded, so the 1 s check cannot overwrite the stored finished days with an empty list. */
let finishedDaysLoaded = false;
/** When practice data was last exported; undefined until the stored value has loaded. */
let lastExportMs: number | null | undefined;
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
  if (copyActive) copyView.setTime(copyTimeText(copyClockState(dayInput(now))) ?? practiceTime.textContent);
}

let lastSavedPracticeMs = -1;

function persistPracticeTime(): void {
  const now = Date.now();
  lastSavedPracticeMs = practiceClock.todayTotalMs(now);
  void savePracticeTime(practiceClock.snapshot(now)).catch(() => undefined);
  void saveCopyTime(copyClock.snapshot(now)).catch(() => undefined);
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

/** How long the canvas size must stay still before a target is judged against it. */
const RESIZE_SETTLE_MS = 350;
let resizeSettleTimer: number | undefined;

/**
 * The canvas changed size: match its pixel size and redraw at once (so the Pencil stays aligned), then, once the
 * size has settled (on the iPad a rotation arrives in steps, the height last), make a new target only if nothing
 * is drawn yet and the old one no longer suits the canvas (actionAfterResize). Strokes, a half-drawn box and
 * feedback are kept.
 */
function handleCanvasResize(): void {
  if (copyActive) return; // The Copy view lays itself out; leaving Copy resizes the canvas.
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return;
  resizeCanvas();
  window.clearTimeout(resizeSettleTimer);
  resizeSettleTimer = window.setTimeout(judgeTargetAfterResize, RESIZE_SETTLE_MS);
}

function judgeTargetAfterResize(): void {
  if (copyActive) return;
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return;
  if (backingOutOfDate(bounds, { width: canvas.width, height: canvas.height }, window.devicePixelRatio || 1)) resizeCanvas();
  const size = { width: bounds.width, height: bounds.height };
  const drill = target ? activeDrill() : null;
  const action = actionAfterResize({ state: trialState, target, relayout: Boolean(drill?.relayout), generatedFor: targetCanvas, canvas: size, cssPxPerMm: cssPxPerMm() });
  if (action === "WAIT") {
    resizeSettleTimer = window.setTimeout(judgeTargetAfterResize, RESIZE_SETTLE_MS);
    return;
  }
  if (action === "NEW_TARGET") {
    beginNewTrial();
    return;
  }
  if (action !== "RELAYOUT" || !target || !drill?.relayout) return;
  const moved = drill.relayout(target, size, cssPxPerMm(), targetHandedness);
  if (!moved) {
    // A target is made to fit the canvas it was made on; a landscape box often does not fit the smaller portrait
    // halves. Before any stroke: a fresh one. With strokes drawn: keep its layout, so turning the iPad back lines
    // everything up again.
    if (trialState === "READY" && trialStrokes.length === 0) beginNewTrial();
    else if (trialState === "READY") showToast(`This ${drill.singular} doesn't fit this way round — turn the iPad back to finish it`);
    return;
  }
  // The same target in the new layout; strokes drawn so far move with it, so they score the same.
  const lastWasCompleted = completedStroke !== null && completedStroke === trialStrokes.at(-1);
  trialStrokes = trialStrokes.map((stroke) => shiftStroke(stroke, moved.strokeShift));
  if (lastWasCompleted) completedStroke = trialStrokes.at(-1) ?? null;
  target = moved.target;
  targetCanvas = size;
  redrawAll();
}

function activeDrill(): Drill {
  return drillFor(activeExercise);
}

/** The drill needs several strokes (Box's 11 edges): progress, Undo and "keep drawing" apply. */
function multiStroke(): boolean {
  return activeDrill().strokesRequired > 1;
}

/** "Box · 4/11", and what is left today: the status line of a drill needing several strokes. */
function progressText(): string {
  const drill = activeDrill();
  const name = drill.singular.charAt(0).toUpperCase() + drill.singular.slice(1);
  const progress = `${name} · ${trialStrokes.length}/${drill.strokesRequired}`;
  return selectedMode === "TODAY" && dailyQueue ? `${progress} · ${queueRemaining(dailyQueue)} left today` : progress;
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

/**
 * The toolbar's mode switch: Today and Copy are buttons, the single drills sit in the Drills menu.
 * The menu shows "Drills" while Today or Copy is on.
 */
function showModeChoice(mode: PracticeMode | "COPY"): void {
  const drill = mode !== "TODAY" && mode !== "COPY" && Array.from(modeSelect.options).some((option) => option.value === mode);
  modeSelect.value = drill ? mode : "";
  modeSelect.classList.toggle("active", drill);
  todayModeButton.setAttribute("aria-pressed", String(mode === "TODAY"));
  copyModeButton.setAttribute("aria-pressed", String(mode === "COPY"));
}

/** Switches mode from the toolbar, unless a stroke is in progress. */
function chooseMode(value: string): void {
  const current = copyActive ? "COPY" : selectedMode;
  if (value === current) { showModeChoice(current); return; }
  if ((copyActive && copyView.isDrawing()) || trialState === "DRAWING") {
    showModeChoice(current);
    showToast("Finish the current stroke before changing modes");
    return;
  }
  // Copy is handled before any practice-mode logic: it has no trials.
  if (value === "COPY") {
    enterCopy();
    return;
  }
  const mode = value as PracticeMode;
  if (!VALID_MODES.includes(mode)) { showModeChoice(current); return; }
  if (copyActive) leaveCopy(mode);
  else resetSession(mode);
  rememberModeDay();
  void savePracticeMode(mode).catch(() => showToast("Practice mode could not be saved"));
}

/** Shown instead of a target when today's queue is finished or nothing is ticked. */
function showDoneCard(queue: DailyQueueState): void {
  updateTodayHud();
  target = null;
  trialState = "PREPARING";
  feedbackCard.hidden = true;
  emptyState.classList.add("hidden");
  undoStrokeButton.hidden = true;
  tipsButton.hidden = true;
  tipsPanel.hidden = true;
  const now = Date.now();
  const day = dayInput(now, queue);
  const card = todayCard(day) ?? "DONE";
  const totalMs = practiceClock.todayTotalMs(now);
  if (card === "NOTHING_TICKED") {
    doneTitle.textContent = "Nothing ticked for Today";
    doneDetail.textContent = "Choose which modes make up the daily queue.";
    doneNote.textContent = "Today's queue is built from the ticked modes.";
  } else if (card === "HANDOFF") {
    doneTitle.textContent = `Drills done · ${formatMinutes(drillMs(totalMs, day.copyMs))}`;
    doneDetail.textContent = `${queue.order.length} reps. Next, a stretch of copying.`;
    doneNote.textContent = "Copy carries on where you left it.";
    doneCopyButton.textContent = `Start copy · ${Math.ceil(copyLeftMs(day) / 60_000)} min`;
  } else {
    doneTitle.textContent = `Done for today · ${formatMinutes(totalMs)}`;
    doneDetail.textContent = day.copyMs >= 60_000
      ? `${queue.order.length} reps · ${formatMinutes(drillMs(totalMs, day.copyMs))} drills · ${formatMinutes(day.copyMs)} copying`
      : `${queue.order.length} reps`;
    doneNote.textContent = "Pick any mode above for free practice. It doesn't count toward the queue; a new one starts at 4 am.";
  }
  recordFinishedDay(now);
  renderWeekDots(doneWeekDots, card === "DONE");
  renderBackupNote(doneBackup, card === "DONE");
  doneSettingsButton.hidden = card !== "NOTHING_TICKED";
  doneCopyButton.hidden = card !== "HANDOFF";
  doneFinishButton.hidden = card !== "HANDOFF";
  doneCard.hidden = false;
  statusText.textContent = card === "NOTHING_TICKED" ? "Today · nothing ticked" : card === "HANDOFF" ? "Today · drills done ✓" : "Today · done ✓";
  redrawAll();
}

/* ---------- Daily flow: drills, then a timed stretch of Copy ---------- */

/** Everything the day's cards and Copy's countdown are worked out from. */
function dayInput(nowMs: number, queue: DailyQueueState = todayQueue()): DayInput {
  return {
    drillReps: queue.order.length,
    drillRepsLeft: queueRemaining(queue),
    copyMs: copyClock.todayTotalMs(nowMs),
    copyBudgetMin,
    marks: marksForToday(dayMarks, nowMs),
  };
}

/** Records today as finished once the flow is done (checked every second and when a Done card shows). */
function recordFinishedDay(nowMs = Date.now()): void {
  if (!finishedDaysLoaded) return;
  const today = dayKey(nowMs);
  if (finishedDays.includes(today) || !dayFinished(dayInput(nowMs))) return;
  finishedDays = addFinishedDay(finishedDays, today);
  void saveFinishedDays(finishedDays).catch(() => undefined);
}

function renderWeekDots(container: HTMLElement, show: boolean): void {
  container.hidden = !show;
  if (!show) return;
  const dots = lastSevenDays(finishedDays, dayKey(Date.now()));
  container.replaceChildren(...dots.map((dot) => {
    const item = document.createElement("span");
    item.className = `week-dot${dot.finished ? " finished" : ""}${dot.isToday ? " today" : ""}`;
    item.title = `${dot.dayKey}${dot.finished ? " · finished" : ""}`;
    item.append(document.createElement("i"), Object.assign(document.createElement("small"), { textContent: dot.weekday }));
    return item;
  }));
  container.setAttribute("aria-label", `Finished on ${dots.filter((dot) => dot.finished).length} of the last seven days`);
}

/** "Last export N days ago" with an Export now button, only when a backup is due. */
function renderBackupNote(container: HTMLElement, show: boolean): void {
  const now = Date.now();
  const practiceDays = Object.values(practiceClock.snapshot(now)).filter((ms) => ms > 0).length;
  const text = show && lastExportMs !== undefined ? backupReminder(lastExportMs, practiceDays, now) : null;
  container.hidden = text === null;
  const label = container.querySelector("span");
  if (label && text) label.textContent = `${text} ·`;
}

function setDayMark(mark: "handoffDeclined" | "doneCardShown"): void {
  dayMarks = { ...marksForToday(dayMarks, Date.now()), [mark]: true };
  void saveDayMarks(dayMarks).catch(() => undefined);
}

/** Compare, Save or New copy in Copy: once Copy time is up, say so, once a day. */
function copyCheckpoint(): void {
  if (!copyActive || dayDoneDialog.open) return;
  const card = copyCardAtCheckpoint(dayInput(Date.now()));
  if (!card) return;
  setDayMark("doneCardShown");
  showDayDoneDialog(card);
  updatePracticeTime();
}

function showDayDoneDialog(card: CopyCard): void {
  const now = Date.now();
  const queue = todayQueue();
  const copyMs = copyClock.todayTotalMs(now);
  if (card === "DAY_DONE") {
    dayDoneTitle.textContent = `Done for today · ${formatMinutes(practiceClock.todayTotalMs(now))}`;
    dayDoneDetail.textContent = `${formatMinutes(copyMs)} copying today. Finish this one if you like; Copy works as usual from here.`;
  } else {
    dayDoneTitle.textContent = `Copy time's up · ${formatMinutes(copyMs)}`;
    dayDoneDetail.textContent = `Today's drills aren't done yet: ${queueRemaining(queue)} left · about ${queueMinutesLeft(queue)} min.`;
  }
  recordFinishedDay(now);
  renderWeekDots(dayDoneWeekDots, card === "DAY_DONE");
  renderBackupNote(dayDoneBackup, card === "DAY_DONE");
  dayDoneTodayButton.hidden = card !== "DRILLS_LEFT";
  dayDoneDialog.dataset.hand = handedness === "LEFT" ? "left" : "right";
  dayDoneDialog.showModal();
}

function goToToday(): void {
  if (dayDoneDialog.open) dayDoneDialog.close();
  showModeChoice("TODAY");
  if (copyActive) leaveCopy("TODAY");
  else resetSession("TODAY");
  void savePracticeMode("TODAY").catch(() => showToast("Practice mode could not be saved"));
}

function renderCopyBudget(): void {
  for (const button of copyBudgetButtons) button.setAttribute("aria-pressed", String(Number(button.dataset.copyBudget) === copyBudgetMin));
}

function setCopyBudget(minutes: number): void {
  copyBudgetMin = minutes;
  renderCopyBudget();
  void saveCopyBudget(minutes).catch(() => showToast("Copy time setting could not be saved"));
  if (!copyActive && !doneCard.hidden) showDoneCard(todayQueue());
  updatePracticeTime();
}

/** Every saved attempt moves the schedule on: the queue in Today, the scheduler otherwise. */
function advanceSchedule(): void {
  if (selectedMode !== "TODAY") {
    scheduler.advance();
    return;
  }
  dailyQueue = advanceQueue(todayQueue());
  void saveDailyQueue(dailyQueue).catch(() => showToast("Today's progress could not be saved"));
  updateTodayHud();
}

function scheduleContext() {
  const generationIndex = targetGenerationIndex - 1;
  if (selectedMode !== "TODAY" || !dailyQueue) return { ...scheduler.context(), generationIndex };
  return { mode: "TODAY" as const, sessionSeed: `daily:${dailyQueue.dayKey}`, sequenceIndex: dailyQueue.position, cycleIndex: 0, generationIndex };
}

/** The 4 am rollover while the page is open: start the new day's queue unless a trial is in progress. */
function checkDayRollover(): void {
  if (selectedMode !== "TODAY" || !dailyQueue || dailyQueue.dayKey === dayKey(Date.now())) return;
  const midTrial = trialState === "DRAWING" || trialState === "PROCESSING" || (trialState === "READY" && trialStrokes.length > 0);
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
  // A Today rep in progress (a stroke, or a box partly drawn) counts as started: keep it.
  const midTrial = selectedMode === "TODAY" && !copyActive
    && (trialState === "DRAWING" || trialState === "PROCESSING" || (trialState === "READY" && trialStrokes.length > 0));
  const { queue, rebuilt } = midTrial ? { queue: todayQueue(), rebuilt: false } : requeueForTicks(dailyQueue, dailyTicks, Date.now());
  if (!rebuilt) {
    showToast("Today's queue has started: applies from tomorrow");
    return;
  }
  dailyQueue = queue;
  void saveDailyQueue(queue).catch(() => undefined);
  if (selectedMode === "TODAY" && !copyActive) beginNewTrial();
  showToast(queue.order.length === 0 ? "Today's queue is empty" : `Today's queue updated · ${queue.order.length} reps`);
}

/** Device-local convenience only, so plain localStorage (guarded) rather than IndexedDB. */
function readTipsOpen(): boolean {
  try { return window.localStorage.getItem(TIPS_OPEN_KEY) === "1"; } catch { return false; }
}

function updateTips(): void {
  const shown = activeDrill().controls.tips;
  tipsButton.hidden = !shown;
  tipsButton.setAttribute("aria-pressed", String(tipsOpen));
  tipsPanel.hidden = !shown || !tipsOpen;
}

function setTipsOpen(open: boolean): void {
  tipsOpen = open;
  try { window.localStorage.setItem(TIPS_OPEN_KEY, open ? "1" : "0"); } catch { /* Private mode: just don't remember. */ }
  updateTips();
}

function updateUndoButton(): void {
  const drawing = activeDrill().controls.undo && (trialState === "READY" || trialState === "DRAWING");
  undoStrokeButton.hidden = !drawing;
  undoStrokeButton.disabled = !drawing || trialState !== "READY" || trialStrokes.length === 0;
}

function undoStroke(): void {
  if (!activeDrill().controls.undo || trialState !== "READY" || trialStrokes.length === 0) return;
  trialStrokes.pop();
  completedStroke = trialStrokes.at(-1) ?? null;
  statusText.textContent = progressText();
  updateUndoButton();
  redrawAll();
}

function redrawAll(): void {
  const bounds = canvas.getBoundingClientRect();
  context.clearRect(0, 0, bounds.width, bounds.height);
  if (!target) return;
  activeDrill().draw(context, {
    target,
    strokes: trialStrokes,
    activeStroke,
    feedback: trialState === "FEEDBACK",
    cssPxPerMm: cssPxPerMm(),
    layoutCanvas: targetCanvas ?? { width: bounds.width, height: bounds.height },
  });
}

function statusForCurrentTrial(): string {
  if (multiStroke()) return progressText();
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
  updateTodayHud();
}

/** In Today the bottom bar shows the day's progress instead of the per-session stats; free modes keep the stats. */
function updateTodayHud(): void {
  const inToday = selectedMode === "TODAY" && dailyQueue !== null;
  hud.classList.toggle("today", inToday);
  todayHud.hidden = !inToday;
  if (!inToday || !dailyQueue) return;
  const progress = queueProgress(dailyQueue);
  todayProgressFill.style.width = `${(progress.fraction * 100).toFixed(1)}%`;
  todayProgress.setAttribute("aria-valuemax", String(progress.total));
  todayProgress.setAttribute("aria-valuenow", String(progress.done));
  todayLeft.textContent = progress.label;
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
  // A target laid out for the drawing hand (a box) is laid out again if not started; one in progress keeps its
  // layout until the next one.
  const drill = activeDrill();
  if (drill.relayout && trialState === "READY" && trialStrokes.length === 0) beginNewTrial();
  else if (drill.relayout) showToast(`Applies from the next ${drill.singular}`);
}

function updateCorrectionGateButton(): void {
  for (const button of correctionButtons) button.setAttribute("aria-pressed", String((button.dataset.corrections === "on") === correctionGateEnabled));
}

function beginNewTrial(): void {
  trialState = "PREPARING";
  activePointerId = null;
  feedbackTap = null;
  activeStroke = null;
  activeSampleKeys = new Set<string>();
  completedStroke = null;
  trialStrokes = [];
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
  targetCanvas = { width: bounds.width, height: bounds.height };
  targetHandedness = handedness;
  const drill = activeDrill();
  target = drill.generate({ width: bounds.width, height: bounds.height }, cssPxPerMm(), scheduler.sessionSeed, targetGenerationIndex, handedness);
  targetGenerationIndex += 1;
  instructionType.textContent = drill.intro.kicker;
  instructionText.textContent = drill.intro.prompt;
  instructionNote.textContent = drill.intro.note ?? DEFAULT_INSTRUCTION_NOTE;
  emptyState.classList.toggle("compact", drill.intro.compact);
  nextTrialButton.textContent = `Next ${drill.singular}`;
  trialState = "READY";
  statusText.textContent = statusForCurrentTrial();
  updateUndoButton();
  updateTips();
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
  showModeChoice(mode);
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
  // During feedback nothing is drawn, so a finger may tap on too; palm rejection while drawing is unchanged.
  if (trialState === "FEEDBACK") {
    startFeedbackTap(event);
    return;
  }
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
  statusText.textContent = multiStroke() ? progressText() : `${EXERCISE_LABELS[activeExercise]} · commit to the movement`;
  updateUndoButton();
  appendPointerSamples(event, "pointerdown");
}

function tapPoint(event: PointerEvent): TapPoint {
  const bounds = canvas.getBoundingClientRect();
  return { xCss: event.clientX - bounds.left, yCss: event.clientY - bounds.top, tMs: event.timeStamp };
}

/** During feedback the canvas draws nothing: a touch is followed only to see whether it is a tap. */
function startFeedbackTap(event: PointerEvent): void {
  event.preventDefault();
  if (feedbackTap !== null) {
    feedbackTap.spoiled = true;
    return;
  }
  feedbackTap = { pointerId: event.pointerId, pen: event.pointerType !== "touch", spoiled: false, points: [tapPoint(event)] };
  try { canvas.setPointerCapture(event.pointerId); } catch { /* Pointer already ended. */ }
}

/** Ends a feedback touch. A tap starts the next rep; a longer touch is ignored. Returns false if the pointer is not one. */
function endFeedbackTap(event: PointerEvent, cancelled: boolean): boolean {
  if (!feedbackTap || event.pointerId !== feedbackTap.pointerId) return false;
  event.preventDefault();
  const { pen, spoiled } = feedbackTap;
  const points = [...feedbackTap.points, tapPoint(event)];
  feedbackTap = null;
  if (cancelled || spoiled || trialState !== "FEEDBACK") return true;
  practiceClock.recordActivity(Date.now());
  if (isTap(points, cssPxPerMm())) beginNewTrial();
  else if (pen) showToast("Not counted — tap to go on"); // A long finger touch is likely a resting hand: say nothing.
  return true;
}

function handlePointerMove(event: PointerEvent): void {
  if (feedbackTap && event.pointerId === feedbackTap.pointerId) {
    event.preventDefault();
    for (const sourceEvent of sourceEvents(event)) feedbackTap.points.push(tapPoint(sourceEvent));
    return;
  }
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

function showFeedback(analysis: AnalysisResult): void {
  const drill = activeDrill();
  feedbackCard.hidden = false;
  nextTrialButton.textContent = "Next";
  if (analysis.executionPassed) {
    feedbackResult.textContent = `Committed ${drill.singular} ✓`;
    feedbackScore.textContent = `Accuracy ${analysis.accuracyScore ?? 0}`;
    feedbackDetail.textContent = drill.feedbackText(analysis.metrics);
    statusText.textContent = `Feedback shown — ${drill.revealName} in blue`;
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

  const drill = activeDrill();
  if (drill.strokesRequired > 1) {
    await finishOneOfSeveral(drill, stroke, target);
    return;
  }

  if (cancelled) {
    try { await saveStroke(stroke); savedStrokeCount += 1; } catch { showToast("Interrupted stroke could not be saved"); }
    beginNewTrial();
    return;
  }
  trialStrokes = [stroke];
  await submitTrial(drill, target);
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

function returnToDrawing(message?: string): void {
  trialState = "READY";
  if (message) showToast(message);
  statusText.textContent = progressText();
  updateUndoButton();
  redrawAll();
}

/** One stroke of a drill needing several has ended: drop it, keep it, or (on the last) score the whole trial. */
async function finishOneOfSeveral(drill: Drill, stroke: RawStroke, trialTarget: TargetDefinition): Promise<void> {
  if (stroke.cancelled) {
    void saveStroke(stroke).then(() => { savedStrokeCount += 1; }, () => undefined);
    returnToDrawing("Stroke interrupted — not counted");
    return;
  }
  const rejection = drill.acceptStroke?.(stroke, cssPxPerMm()) ?? null;
  if (rejection) {
    returnToDrawing(rejection);
    return;
  }
  trialStrokes.push(stroke);
  if (trialStrokes.length < drill.strokesRequired) {
    returnToDrawing();
    return;
  }
  trialState = "PROCESSING";
  updateUndoButton();
  statusText.textContent = progressText();
  await submitTrial(drill, trialTarget);
}

/**
 * Scores the trial's strokes and saves the record. A one-stroke drill's record holds `rawStroke`, a several-stroke
 * drill's `rawStrokes` (each stroke is stored once, inside its trial, since 0.15.3).
 */
async function submitTrial(drill: Drill, trialTarget: TargetDefinition): Promise<void> {
  const strokes = [...trialStrokes];
  try {
    const analysis = drill.analyse(trialTarget, strokes, { cssPxPerMm: cssPxPerMm(), correctionGateEnabled });
    lastAnalysis = analysis;
    const trial = {
      id: createId(),
      appVersion: APP_VERSION,
      metricVersion: drill.versions.metric,
      scoringVersion: drill.versions.scoring,
      createdAtEpochMs: Date.now(),
      exerciseType: drill.id,
      practiceMode: selectedMode,
      correctionGateEnabled: drill.usesCorrectionGate ? correctionGateEnabled : false,
      schedule: scheduleContext(),
      target: trialTarget,
      ...(drill.strokesRequired > 1 ? { rawStrokes: strokes } : { rawStroke: strokes[0] }),
      calibrationId: calibration?.id ?? null,
      derived: analysis,
    } as TrialRecord;
    await saveTrial(trial);
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

function canvasBoxText(): string {
  const bounds = canvas.getBoundingClientRect();
  const stale = backingOutOfDate(bounds, { width: canvas.width, height: canvas.height }, window.devicePixelRatio || 1);
  return `${Math.round(bounds.width * 10) / 10} × ${Math.round(bounds.height * 10) / 10}${stale ? " (pixels out of date)" : ""}`;
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
    "Drawing canvas (CSS px)": canvasBoxText(),
    "Drawing canvas (pixels)": `${canvas.width} × ${canvas.height}`,
    "Canvas size watcher fixes": lateCanvasResizes,
    "Window inner height": window.innerHeight,
    "Visual viewport": window.visualViewport ? `${Math.round(window.visualViewport.height)} high, offset ${Math.round(window.visualViewport.offsetTop)}` : "Not available",
    "--app-height": document.documentElement.style.getPropertyValue("--app-height") || "Not set",
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

function downloadJson(filename: string, value: unknown, compact = false): void {
  const blob = new Blob([compact ? JSON.stringify(value) : JSON.stringify(value, null, 2)], { type: "application/json" });
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
      // Each stroke once: trials hold their own, so only strokes with no trial are listed separately.
      selectedMode, correctionGateEnabled, device: getDeviceSnapshot(), strokes: looseStrokes(strokes, strokeIdsInTrials(trials)), trials,
      practiceTimeByDay: practiceClock.snapshot(Date.now()),
      copyTimeByDay: copyClock.snapshot(Date.now()),
      finishedDays,
    };
    downloadJson(`circle-trainer-${dateStamp()}.json`, bundle, true);
    lastExportMs = bundle.exportedAt;
    void saveLastExport(bundle.exportedAt).catch(() => undefined);
    doneBackup.hidden = true;
    dayDoneBackup.hidden = true;
    showToast("JSON export created");
    await offerTrim(trials, strokes, bundle.exportedAt);
  } catch { showToast("Data export failed"); }
}

/** Removes the strokes store's spare copies of trial strokes (nothing is lost: each trial holds its own). */
function removeDuplicateStrokes(ids: readonly string[]): void {
  if (ids.length === 0) return;
  void deleteStrokes(ids).then(async () => {
    const totals = await getPrunedTotals();
    await savePrunedTotals({ ...totals, strokesDeleted: totals.strokesDeleted + ids.length });
  }).catch(() => undefined);
}

const TRIM_BATCH = 200;

/**
 * After an export: if any Pencil points are past RAW_SAMPLE_DAYS (and in that export), ask whether the file was
 * saved, and only then trim them (core/retention.ts). Scores and trial records stay. Trials are rewritten in batches,
 * each all-or-nothing, so an interruption leaves the rest for the next export.
 */
async function offerTrim(trials: readonly TrialRecord[], strokes: readonly RawStroke[], exportedAt: number): Promise<void> {
  const now = Date.now();
  const toPrune = trialsToPrune(trials, now, exportedAt);
  const looseOld = oldLooseStrokeIds(strokes, strokeIdsInTrials(trials), now, exportedAt);
  if (toPrune.length === 0 && looseOld.length === 0) return;
  const samples = toPrune.reduce((sum, trial) => sum + trialSampleCount(trial), 0);
  const ok = window.confirm(
    `Did the export file save? If it did, Circle Trainer can now remove the Pencil points of ${toPrune.length.toLocaleString()} `
    + `trial${toPrune.length === 1 ? "" : "s"} older than ${RAW_SAMPLE_DAYS} days to save space. Their scores and records stay, `
    + "and trophies keep their drawings. The exported file keeps everything.\n\nOK to trim now, Cancel to keep everything for now.",
  );
  if (!ok) return;
  try {
    let totals = await getPrunedTotals();
    for (let start = 0; start < toPrune.length; start += TRIM_BATCH) {
      const batch = toPrune.slice(start, start + TRIM_BATCH);
      await saveTrials(batch.map(pruneTrial));
      totals = { ...totals, trials: totals.trials + batch.length, samples: totals.samples + batch.reduce((sum, trial) => sum + trialSampleCount(trial), 0) };
      await savePrunedTotals(totals);
    }
    await deleteStrokes(looseOld);
    if (looseOld.length > 0) await savePrunedTotals({ ...totals, strokesDeleted: totals.strokesDeleted + looseOld.length });
    savedStrokeCount -= looseOld.length;
    showToast(`Trimmed ${samples.toLocaleString()} Pencil points`);
    if (dataDialog.open) void showDataDialog();
  } catch { showToast("Trimming stopped; nothing is lost, and it continues after the next export"); }
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
    const totals = await getPrunedTotals();
    const trimmed = totals.trials === 0
      ? "Nothing trimmed yet."
      : `Trimmed so far: Pencil points of ${totals.trials.toLocaleString()} trial${totals.trials === 1 ? "" : "s"} (${totals.samples.toLocaleString()} points).`;
    dataRetention.textContent = `Every trial and score is kept. Pencil points are kept for ${RAW_SAMPLE_DAYS} days, and for good for trophies; `
      + `older ones can be trimmed after you export (you are asked first). ${trimmed}`;
  } catch { dataSummary.textContent = "Saved data could not be read in this browser."; }
  if (!dataDialog.open) dataDialog.showModal();
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
  undoStrokeButton.addEventListener("click", undoStroke);
  tipsButton.addEventListener("click", () => setTipsOpen(!tipsOpen));
  requiredElement<HTMLButtonElement>("#closeBoxTipsButton").addEventListener("click", () => setTipsOpen(false));
  modeSelect.addEventListener("change", () => chooseMode(modeSelect.value));
  todayModeButton.addEventListener("click", () => chooseMode("TODAY"));
  copyModeButton.addEventListener("click", () => chooseMode("COPY"));
  requiredElement<HTMLButtonElement>("#settingsButton").addEventListener("click", () => { configureRuler(); renderDailyTicks(); renderCopyBudget(); calibrationDialog.showModal(); });
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
  canvas.addEventListener("pointerup", (event) => { if (!endFeedbackTap(event, false)) void finishStroke(event, false); });
  canvas.addEventListener("pointercancel", (event) => { if (!endFeedbackTap(event, true)) void finishStroke(event, true); });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("resize", handleCanvasResize);
  // The Home Screen app corrects its height late (--app-height), without a window resize, so also watch the
  // canvas itself and resize whenever its pixel size no longer matches its box.
  new ResizeObserver(() => {
    const bounds = canvas.getBoundingClientRect();
    if (copyActive || !backingOutOfDate(bounds, { width: canvas.width, height: canvas.height }, window.devicePixelRatio || 1)) return;
    lateCanvasResizes += 1;
    handleCanvasResize();
  }).observe(canvas);
  document.addEventListener("visibilitychange", () => {
    const visible = document.visibilityState === "visible";
    practiceClock.setVisible(visible, Date.now());
    copyClock.setVisible(visible && copyActive, Date.now());
    if (visible) checkDayRollover();
    if (!visible) persistPracticeTime();
    updatePracticeTime();
  });
  window.addEventListener("pagehide", persistPracticeTime);
  doneSettingsButton.addEventListener("click", () => { configureRuler(); renderDailyTicks(); renderCopyBudget(); calibrationDialog.showModal(); });
  doneCopyButton.addEventListener("click", () => { if (trialState !== "DRAWING") enterCopy(); });
  for (const note of [doneBackup, dayDoneBackup]) note.querySelector("button")?.addEventListener("click", () => void exportAllData());
  doneFinishButton.addEventListener("click", () => { setDayMark("handoffDeclined"); showDoneCard(todayQueue()); });
  dayDoneTodayButton.addEventListener("click", goToToday);
  for (const button of copyBudgetButtons) button.addEventListener("click", () => setCopyBudget(Number(button.dataset.copyBudget)));
  window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    updatePracticeTime();
    recordFinishedDay();
  }, 1000);
  // Saving on pagehide is not reliable (the write may not finish), so also save while time is accruing.
  window.setInterval(() => { if (practiceClock.todayTotalMs(Date.now()) !== lastSavedPracticeMs) persistPracticeTime(); }, 10_000);
}

/**
 * In the Home Screen app, iPadOS can keep reporting the old height to CSS
 * after a rotation, so the layout runs off the screen. Size the app from the
 * window itself, and look again shortly after, since the new size arrives late.
 */
let appHeight = 0;

function syncAppHeight(): void {
  // The stale value is always the larger (the old portrait height), so take the smaller reading.
  const height = Math.round(Math.min(window.innerHeight, window.visualViewport?.height ?? Infinity));
  if (height <= 0 || height === appHeight) return;
  appHeight = height;
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

function watchAppHeight(): void {
  let timers: number[] = [];
  const sync = () => {
    syncAppHeight();
    for (const timer of timers) window.clearTimeout(timer);
    timers = [150, 400, 800].map((delay) => window.setTimeout(syncAppHeight, delay));
  };
  window.addEventListener("resize", sync);
  window.addEventListener("orientationchange", sync);
  window.visualViewport?.addEventListener("resize", sync);
  new ResizeObserver(sync).observe(document.documentElement);
  // Backstop in case a rotation arrives without any of those events.
  window.setInterval(() => { if (document.visibilityState === "visible") syncAppHeight(); }, 1000);
  syncAppHeight();
}

async function initialize(): Promise<void> {
  watchAppHeight();
  wireControls();
  resizeCanvas();
  try {
    const [storedCalibration, storedMode, storedCorrectionGate, storedHandedness, storedPracticeTime, storedTicks, storedQueue, strokes, trials, storedCopyTime, storedCopyBudget, storedMarks, storedFinishedDays, storedLastExport] = await Promise.all([
      getCalibration(), getPracticeMode(), getCorrectionGateEnabled(), getHandedness(), getPracticeTime(), getDailyTicks(), getDailyQueue(), getStrokes(), getTrials(),
      getCopyTime(), getCopyBudget(), getDayMarks(), getFinishedDays(), getLastExport(),
    ]);
    copyClock = new PracticeClock(storedCopyTime ?? {}, false);
    copyBudgetMin = storedCopyBudget ?? DEFAULT_COPY_BUDGET_MIN;
    dayMarks = storedMarks;
    finishedDays = storedFinishedDays;
    finishedDaysLoaded = true;
    lastExportMs = storedLastExport;
    dailyTicks = storedTicks ?? [...DEFAULT_DAILY_TICKS];
    dailyQueue = storedQueue;
    practiceClock = new PracticeClock(storedPracticeTime ?? {}, document.visibilityState === "visible");
    calibration = storedCalibration;
    handedness = storedHandedness ?? DEFAULT_HANDEDNESS;
    correctionGateEnabled = storedCorrectionGate ?? false;
    selectedMode = storedMode && VALID_MODES.includes(storedMode) ? storedMode : FIRST_DRILL;
    // The Mixed modes left the menu in 0.15.0 (Today interleaves the drills); a stored one opens on Today.
    if (selectedMode === "MIXED_BLOCKED" || selectedMode === "MIXED_RANDOM") selectedMode = "TODAY";
    // Open on Today while today's queue has reps left, unless a free mode was picked earlier today.
    const queue = todayQueue();
    selectedMode = startupMode(selectedMode, readModeDay(), dayKey(Date.now()), queue.order.length > 0 && !isQueueDone(queue));
    const inTrials = strokeIdsInTrials(trials);
    savedStrokeCount = looseStrokes(strokes, inTrials).length + inTrials.size;
    savedTrialCount = trials.length;
    // Strokes up to 0.15.2 were stored twice (in the strokes store and inside their trial): drop the spare copies.
    removeDuplicateStrokes(duplicateStrokeIds(strokes, inTrials));
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
  // Copy reopens after a reload the same day; a new day opens on Today while it has reps left.
  const copyWasOpen = readCopyActive();
  const repsLeft = dailyQueue !== null && queueRemaining(dailyQueue) > 0;
  if (copyWasOpen === "today" || (copyWasOpen === "earlier" && !repsLeft)) enterCopy();
  else if (copyWasOpen === "earlier") rememberCopyActive(false);
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
