import { dayKey, formatClock, formatMinutes } from "./timer";
import type { PracticeMode } from "./types";

/**
 * The daily flow: drills (Today's queue) as the warm-up, then a timed stretch of Copy, then "done for today".
 * There is no "flow in progress" state. Everything is derived from the day's drill queue, the day's active Copy
 * time (a second practice clock that runs only while Copy is open) and two per-day marks: the handoff card was
 * declined ("Finish for today"), and the Done card has been shown in Copy. All of it uses the timer's 4 am day key.
 */

/** Minutes of Copy per day; 0 is Off. */
export const COPY_BUDGET_CHOICES = [0, 15, 30, 45, 60] as const;
export const DEFAULT_COPY_BUDGET_MIN = 30;

export function parseCopyBudget(value: unknown): number | null {
  return typeof value === "number" && (COPY_BUDGET_CHOICES as readonly number[]).includes(value) ? value : null;
}

/** Per-day marks. A mark from an earlier day means nothing today. */
export interface DayMarks {
  dayKey: string;
  /** "Finish for today" was tapped on the handoff card. */
  handoffDeclined: boolean;
  /** Copy has shown its end-of-time card today. */
  doneCardShown: boolean;
}

export function emptyMarks(day: string): DayMarks {
  return { dayKey: day, handoffDeclined: false, doneCardShown: false };
}

/** The marks for the practice day containing nowMs: the saved ones if they are today's, otherwise fresh ones. */
export function marksForToday(saved: DayMarks | null, nowMs: number): DayMarks {
  const today = dayKey(nowMs);
  return saved && saved.dayKey === today ? saved : emptyMarks(today);
}

export function parseMarks(value: unknown): DayMarks | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DayMarks>;
  if (typeof candidate.dayKey !== "string") return null;
  return { dayKey: candidate.dayKey, handoffDeclined: candidate.handoffDeclined === true, doneCardShown: candidate.doneCardShown === true };
}

export interface DayInput {
  /** Reps in today's queue; 0 when nothing is ticked. */
  drillReps: number;
  drillRepsLeft: number;
  /** Active Copy time today. */
  copyMs: number;
  /** Minutes; 0 is Off. */
  copyBudgetMin: number;
  marks: DayMarks;
}

export function budgetMs(input: Pick<DayInput, "copyBudgetMin">): number {
  return input.copyBudgetMin * 60_000;
}

/** Drills count as done when the queue is finished, or when nothing is ticked (there are none to do). */
export function drillsDone(input: Pick<DayInput, "drillReps" | "drillRepsLeft">): boolean {
  return input.drillReps === 0 || input.drillRepsLeft <= 0;
}

/** Copy time still to do today; 0 when the budget is Off or used up. */
export function copyLeftMs(input: Pick<DayInput, "copyMs" | "copyBudgetMin">): number {
  return Math.max(0, budgetMs(input) - input.copyMs);
}

/** Which card Today shows once its queue is finished (null while reps remain). */
export type TodayCard = "NOTHING_TICKED" | "HANDOFF" | "DONE";

export function todayCard(input: DayInput): TodayCard | null {
  if (input.drillReps === 0) return "NOTHING_TICKED";
  if (input.drillRepsLeft > 0) return null;
  if (copyLeftMs(input) > 0 && !input.marks.handoffDeclined) return "HANDOFF";
  return "DONE";
}

/** What Copy's status line shows about time. */
export type CopyClockState =
  | { kind: "OFF" }
  | { kind: "COUNTDOWN"; leftMs: number }
  | { kind: "TIME_UP" }
  | { kind: "DONE"; copiedMs: number };

export function copyClockState(input: DayInput): CopyClockState {
  if (input.copyBudgetMin <= 0) return { kind: "OFF" };
  const left = copyLeftMs(input);
  if (left > 0) return { kind: "COUNTDOWN", leftMs: left };
  return input.marks.doneCardShown ? { kind: "DONE", copiedMs: input.copyMs } : { kind: "TIME_UP" };
}

/** Countdown text, rounded up so it reaches 0:00 only when time is up: "12:40". */
export function formatCountdown(ms: number): string {
  return formatClock(Math.ceil(ms / 1000) * 1000);
}

/** The time part of Copy's status line; null means "show the usual practice clock". */
export function copyTimeText(state: CopyClockState): string | null {
  switch (state.kind) {
    case "OFF": return null;
    case "COUNTDOWN": return `${formatCountdown(state.leftMs)} left`;
    case "TIME_UP": return "Time's up · finish this one";
    case "DONE": return `${formatMinutes(state.copiedMs)} copied`;
  }
}

/**
 * The card Copy shows when Compare, Save or New copy is tapped after time is up: once a day. "DAY_DONE" when the
 * drills are done too, "DRILLS_LEFT" when they are not (it offers Today instead of saying the day is done).
 */
export type CopyCard = "DAY_DONE" | "DRILLS_LEFT";

export function copyCardAtCheckpoint(input: DayInput): CopyCard | null {
  if (copyClockState(input).kind !== "TIME_UP") return null;
  return drillsDone(input) ? "DAY_DONE" : "DRILLS_LEFT";
}

/** Drill time today: all practice time less Copy time (both clocks count Copy activity). */
export function drillMs(totalMs: number, copyMs: number): number {
  return Math.max(0, totalMs - copyMs);
}

/**
 * The mode the page opens on. Today while its queue has reps left, unless a free mode was picked
 * from the menu earlier the same practice day: then a reload (Safari dropping the tab, a dev-server
 * reload) keeps you in it. A new day, or a mode picked on an earlier day, opens on Today.
 */
export function startupMode(stored: PracticeMode, storedModeDay: string | null, today: string, repsLeft: boolean): PracticeMode {
  if (!repsLeft) return stored;
  if (stored !== "TODAY" && storedModeDay === today) return stored;
  return "TODAY";
}
