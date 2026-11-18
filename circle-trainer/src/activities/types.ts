import type { ExerciseType, Handedness, PracticeMode, ScheduleContext, TrialRecord } from "../core/types";

/**
 * An activity is one kind of screen (since 0.17.0): Drills (a target, strokes, a score, next) and Copy (a reference
 * beside a drawing frame, timed, not scored). The shell mounts each once and shows one at a time. An activity never
 * imports the shell: everything shared reaches it through its host. The shell imports an activity only through its
 * folder's index.ts.
 */
export interface MountedActivity<Request = void> {
  show(request: Request): void;
  hide(): void;
  /** A stroke or a multi-stroke trial is in progress: do not switch away or start the new day under it. */
  isBusy(): boolean;
  /** The Pencil is down right now (mode changes wait for the stroke to end). */
  isDrawing(): boolean;
  /** The drawing hand changed. */
  onHandedness(): void;
}

/** What the shell lends every activity. */
export interface ActivityHost {
  cssPxPerMm(): number;
  handedness(): Handedness;
  toast(message: string): void;
  /** The status line under the title. */
  setStatus(text: string): void;
  /**
   * Pencil or finger activity, for the practice clock (and Copy's clock while Copy is open). `save` stores the
   * day's time now (the end of a stroke); `show` refreshes the time on screen.
   */
  recordActivity(options: { save: boolean; show: boolean }): void;
}

/** What the shell lends the Drills activity on top. */
export interface DrillsHost extends ActivityHost {
  appVersion: string;
  calibrationId(): string | null;
  correctionGateEnabled(): boolean;
  /** Trials and strokes just saved (or loose strokes), for the counts in Diagnostics. */
  recordSaved(counts: { trials: number; strokes: number }): void;
  today: {
    /** The next rep of today's queue, or null when it is finished (or empty). */
    next(): ExerciseType | null;
    /** A Today rep was saved: the queue moves on. */
    repDone(): void;
    /** The schedule stored with a Today trial, or null when there is no queue. */
    scheduleContext(generationIndex: number): ScheduleContext | null;
    /** "Today · 12 left · about 4 min", or null when there is no queue. */
    status(): string | null;
    /** Reps left today, or null when there is no queue. */
    repsLeft(): number | null;
    /** The bottom bar's Today progress. */
    updateHud(): void;
    /** The queue is done: show the Today card (handoff, done, or nothing ticked) in the drawing area. */
    showDone(): void;
    hideDone(): void;
  };
}

export interface MountedDrills extends MountedActivity<{ mode: PracticeMode }> {
  /** A fresh target (after a tick, calibration or day change, or Next). */
  newTrial(): void;
  /** Stored trials at startup: which drills were introduced and their best scores. */
  loadHistory(trials: readonly TrialRecord[]): void;
  /** All practice data was deleted. */
  clearHistory(): void;
  /** The drill runner's lines of the Diagnostics report. */
  diagnostics(): DrillsDiagnostics;
}

export interface DrillsDiagnostics {
  currentExercise: ExerciseType;
  pressureObserved: boolean;
  tiltObserved: boolean;
  lastUniqueSamples: number;
  lastUniqueSampleRate: string;
  timestampHistogram: string;
  overlappingSamplesRemoved: number;
  outOfOrderBatchesRepaired: number;
  fingerTouchesIgnored: number;
  canvasCss: string;
  canvasPixels: string;
  canvasWatcherFixes: number;
  lastNormalizedError: string;
}

/** What the shell lends the Copy activity on top. */
export interface CopyHost extends ActivityHost {
  /** Compare, Save or New copy: a natural pause, where the shell may show the end-of-time card. */
  checkpoint(): void;
}

export interface MountedCopy extends MountedActivity {
  /** The time part of Copy's status line. */
  setTime(text: string): void;
}
