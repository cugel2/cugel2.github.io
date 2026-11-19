import { ALL_EXERCISE_TYPES } from "../activities/drills";
import type { MountedCopy, MountedDrills, MountedMemory } from "../activities/types";
import { DEFAULT_COPY_BUDGET_MIN, type DayMarks } from "../core/dailyFlow";
import { DEFAULT_DAILY_TICKS, type DailyQueueState } from "../core/dailyQueue";
import { PracticeClock } from "../core/timer";
import { DEFAULT_HANDEDNESS, type DeviceSnapshot, type ExerciseType, type Handedness, type PhysicalCalibration, type PracticeMode } from "../core/types";

/** The shell's shared state and constants (moved from main.ts in 0.17.0). */

export const APP_VERSION = "0.19.0";
export const SCHEMA_VERSION = "4" as const;
export const DEFAULT_CSS_PX_PER_MM = 96 / 25.4;
export const VALID_MODES: readonly PracticeMode[] = [...ALL_EXERCISE_TYPES, "MIXED_BLOCKED", "MIXED_RANDOM", "TODAY"];
/** The first drill in the menu: where a fresh install starts. */
export const FIRST_DRILL = ALL_EXERCISE_TYPES[0];

export const app = {
  calibration: null as PhysicalCalibration | null,
  correctionGateEnabled: false,
  handedness: DEFAULT_HANDEDNESS as Handedness,
  /** The practice mode: a drill, Today, or a retired Mixed mode. Copy and Memory are not modes; see studio. */
  selectedMode: FIRST_DRILL as PracticeMode,
  /**
   * Copy or Memory is open (they share one screen), or null for the drills. Neither is a practice mode: no target,
   * score or trial. This sits beside selectedMode, which is where leaving them returns to.
   */
  studio: null as Studio | null,
  practiceClock: new PracticeClock({}, document.visibilityState === "visible"),
  /** Copy time only: runs while Copy is open and the page is visible, with the practice clock's idle rule. */
  copyClock: new PracticeClock({}, false),
  /** Memory time only (0.19.0+), the same way while Memory is open. */
  memoryClock: new PracticeClock({}, false),
  copyBudgetMin: DEFAULT_COPY_BUDGET_MIN,
  dayMarks: null as DayMarks | null,
  /** Days whose flow was finished (sorted day keys), shown as the seven-dot row on the Done cards. */
  finishedDays: [] as string[],
  /** Set once stored settings have loaded, so the 1 s check cannot overwrite the stored finished days with an empty list. */
  finishedDaysLoaded: false,
  /** When practice data was last exported; undefined until the stored value has loaded. */
  lastExportMs: undefined as number | null | undefined,
  dailyTicks: [...DEFAULT_DAILY_TICKS] as ExerciseType[],
  dailyQueue: null as DailyQueueState | null,
  savedStrokeCount: 0,
  savedTrialCount: 0,
};

/** The mounted activities, set once at startup (main.ts). */
export const activities = {
  drills: null as unknown as MountedDrills,
  copy: null as unknown as MountedCopy,
  memory: null as unknown as MountedMemory,
};

/** Copy and Memory, the two modes on the shared reference-and-drawing screen. */
export type Studio = "COPY" | "MEMORY";

export function studioActivity(studio: Studio): MountedCopy | MountedMemory {
  return studio === "COPY" ? activities.copy : activities.memory;
}

export function studioClock(studio: Studio): PracticeClock {
  return studio === "COPY" ? app.copyClock : app.memoryClock;
}

export function cssPxPerMm(): number {
  return app.calibration?.cssPxPerMm ?? DEFAULT_CSS_PX_PER_MM;
}

export function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

export function createId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getDeviceSnapshot(): DeviceSnapshot {
  return {
    userAgent: navigator.userAgent,
    viewportWidthCssPx: window.innerWidth,
    viewportHeightCssPx: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    pointerEvents: "PointerEvent" in window,
    coalescedEvents: "PointerEvent" in window && typeof PointerEvent.prototype.getCoalescedEvents === "function",
  };
}

/* ---------- toast ---------- */

const toast = requiredElement<HTMLElement>("#toast");
let toastTimer: number | undefined;

export function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2200);
}

/* ---------- status line ---------- */

const statusText = requiredElement<HTMLElement>("#statusText");

export function setStatus(text: string): void {
  statusText.textContent = text;
}
