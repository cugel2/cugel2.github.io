import { seededRandom, shuffle } from "./random";
import { ALL_EXERCISE_TYPES } from "./scheduler";
import { dayKey } from "./timer";
import type { ExerciseType } from "./types";

/**
 * "Today": a finishable set of reps each day. The user keeps standing ticks per mode; each practice day's queue
 * is built from the ticks at the first open of that day (so evening changes apply tomorrow), served shuffled
 * across modes, and every attempt counts. Days roll over at 4 am (the timer's day key). Unfinished reps are
 * dropped at rollover: there is no backlog.
 */

/** Reps per ticked mode: about 2 minutes of each quick shape and about 5 minutes of boxes. Provisional. */
export const DAILY_COUNTS: Record<ExerciseType, number> = {
  LINE: 40,
  ARC: 30,
  CIRCLE: 24,
  ELLIPSE: 24,
  S_CURVE: 20,
  TAPER: 24,
  BOX: 10,
};

/** Rough seconds per attempt, used only for the "about N min" estimate. */
export const SECONDS_PER_REP: Record<ExerciseType, number> = {
  LINE: 3,
  ARC: 4,
  CIRCLE: 5,
  ELLIPSE: 5,
  S_CURVE: 6,
  TAPER: 5,
  BOX: 30,
};

/** Ticked when nothing has been chosen yet: about 11 minutes. */
export const DEFAULT_DAILY_TICKS: readonly ExerciseType[] = ["LINE", "CIRCLE", "ELLIPSE", "BOX"];

export interface DailyQueueState {
  dayKey: string;
  /** The day's reps in serving order. */
  order: ExerciseType[];
  /** How many of them are done. */
  position: number;
}

/** Ticks in the fixed menu order, without duplicates or unknown values. */
export function normalizeTicks(ticks: readonly string[]): ExerciseType[] {
  return ALL_EXERCISE_TYPES.filter((type) => ticks.includes(type));
}

export function buildDailyQueue(day: string, ticks: readonly ExerciseType[]): DailyQueueState {
  const reps = normalizeTicks(ticks).flatMap((type) => Array.from({ length: DAILY_COUNTS[type] }, () => type));
  return { dayKey: day, order: shuffle(reps, seededRandom(`daily:${day}`)), position: 0 };
}

/**
 * Today's queue: the saved one if it belongs to the current practice day, otherwise a fresh one from the ticks.
 * One exception to "ticks apply tomorrow": a queue that was built empty (nothing ticked) is rebuilt, so the first
 * ticks of the day take effect at once.
 */
export function ensureTodayQueue(saved: DailyQueueState | null, ticks: readonly ExerciseType[], nowMs: number): DailyQueueState {
  const today = dayKey(nowMs);
  if (saved && saved.dayKey === today && saved.order.length > 0) return saved;
  return buildDailyQueue(today, ticks);
}

export function currentQueueExercise(state: DailyQueueState): ExerciseType | null {
  return state.order[state.position] ?? null;
}

export function advanceQueue(state: DailyQueueState): DailyQueueState {
  return { ...state, position: Math.min(state.order.length, state.position + 1) };
}

export function queueRemaining(state: DailyQueueState): number {
  return state.order.length - state.position;
}

export function isQueueDone(state: DailyQueueState): boolean {
  return state.order.length > 0 && state.position >= state.order.length;
}

/** Whole minutes left, rounded up; 0 when done. */
export function queueMinutesLeft(state: DailyQueueState): number {
  const seconds = state.order.slice(state.position).reduce((sum, type) => sum + SECONDS_PER_REP[type], 0);
  return Math.ceil(seconds / 60);
}

export function dailyMinutes(ticks: readonly ExerciseType[]): number {
  return Math.round(normalizeTicks(ticks).reduce((sum, type) => sum + DAILY_COUNTS[type] * SECONDS_PER_REP[type], 0) / 60);
}

/** A stored queue, if it is well formed. */
export function parseQueueState(value: unknown): DailyQueueState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DailyQueueState>;
  if (typeof candidate.dayKey !== "string" || !Array.isArray(candidate.order) || typeof candidate.position !== "number") return null;
  if (!candidate.order.every((type) => ALL_EXERCISE_TYPES.includes(type))) return null;
  return { dayKey: candidate.dayKey, order: [...candidate.order], position: Math.max(0, Math.min(candidate.order.length, Math.floor(candidate.position))) };
}
