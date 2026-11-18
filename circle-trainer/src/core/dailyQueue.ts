import { seededRandom, type RandomSource } from "./random";
import { ALL_EXERCISE_TYPES } from "./scheduler";
import { DAILY_COUNTS, SECONDS_PER_REP } from "../activities/drills/registry";
import { dayKey } from "./timer";
import type { ExerciseType } from "./types";

/**
 * "Today": a finishable set of reps each day. The user keeps standing ticks per mode; each practice day's queue
 * is built from the ticks at the first open of that day (tick changes apply at once until its first rep is done,
 * then from tomorrow), served interleaved across modes, and every attempt counts. Days roll over at 4 am (the timer's day key). Unfinished reps are
 * dropped at rollover: there is no backlog.
 */

/** Reps per ticked mode and rough seconds per rep: views over the drill registry (0.16.0), re-exported here. Provisional. */
export { DAILY_COUNTS, SECONDS_PER_REP };

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
  const counts = new Map(normalizeTicks(ticks).map((type) => [type, DAILY_COUNTS[type]] as const));
  return { dayKey: day, order: interleave(counts, seededRandom(`daily:${day}`)), position: 0 };
}

/**
 * A random order of the reps in which the same mode comes back-to-back as little as possible, so nearly every rep
 * means switching to a different movement (interleaved practice; contextual interference). Runs are capped at the
 * shortest length the counts allow: 1 (no repeats at all) unless one mode outnumbers all the others together, as
 * with 40 lines and 10 boxes, where the lines are then spread out evenly in short runs between the boxes.
 * Each step picks at random among the modes that keep the rest arrangeable, weighted by how many reps each has left,
 * and repeats the previous mode only about as often as its surplus forces, spread through the queue.
 */
export function interleave<T>(counts: ReadonlyMap<T, number>, random: RandomSource): T[] {
  const left = new Map([...counts].filter(([, count]) => count > 0));
  let total = [...left.values()].reduce((sum, count) => sum + count, 0);
  const maxRun = Math.max(1, ...[...left.values()].map((count) => Math.ceil(count / (total - count + 1))));
  const order: T[] = [];
  let last: T | null = null;
  let run = 0;

  /** The remaining reps can still be ordered with runs of at most maxRun, given the run in progress. */
  const arrangeable = (tail: T, tailRun: number): boolean => [...left].every(([type, count]) => {
    const others = total - count;
    return type === tail ? count <= maxRun - tailRun + maxRun * others : count <= maxRun * (others + 1);
  });

  while (total > 0) {
    const options = [...left].filter(([type, count]) => {
      const nextRun = type === last ? run + 1 : 1;
      if (nextRun > maxRun) return false;
      left.set(type, count - 1);
      total -= 1;
      const ok = arrangeable(type, nextRun);
      left.set(type, count);
      total += 1;
      return ok;
    });
    const switches = options.filter(([type]) => type !== last);
    const repeats = options.filter(([type]) => type === last);
    // A mode with more reps left than all the others together takes every slot it can, so it never falls behind.
    const dominant = switches.filter(([, count]) => count > total - count);
    // Repeat the last mode only as often as its surplus over the others forces, at random points so the
    // unavoidable repeats are spread through the queue rather than bunched at the end.
    const lastCount: number = last === null ? 0 : left.get(last) ?? 0;
    const surplus = Math.max(0, lastCount - (total - lastCount));
    const repeatNow: boolean = repeats.length > 0 && (switches.length === 0 || (dominant.length === 0 && random() < surplus / lastCount));
    const preferred = repeatNow ? repeats : dominant.length > 0 ? dominant : switches;
    // Should not happen; if it ever does, take the mode with most reps left rather than fail.
    const pool = preferred.length > 0 ? preferred : [[...left].reduce((best, entry) => (entry[1] > best[1] ? entry : best))];
    let pick = random() * pool.reduce((sum, [, count]) => sum + count, 0);
    let chosen: T = pool[pool.length - 1][0];
    for (const [type, count] of pool) {
      pick -= count;
      if (pick < 0) { chosen = type; break; }
    }
    run = chosen === last ? run + 1 : 1;
    last = chosen;
    order.push(chosen);
    const remaining = left.get(chosen)! - 1;
    if (remaining === 0) left.delete(chosen);
    else left.set(chosen, remaining);
    total -= 1;
  }
  return order;
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

/**
 * After the ticks change: today's queue is rebuilt from the new ticks while no rep of it has been done (or it is
 * empty), so changing your mind before starting takes effect at once. Once a rep is done, changes wait for tomorrow.
 */
export function requeueForTicks(saved: DailyQueueState | null, ticks: readonly ExerciseType[], nowMs: number): { queue: DailyQueueState; rebuilt: boolean } {
  const today = dayKey(nowMs);
  if (saved && saved.dayKey === today && saved.order.length > 0 && saved.position > 0) return { queue: saved, rebuilt: false };
  return { queue: buildDailyQueue(today, ticks), rebuilt: true };
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

/** What Today's bottom bar shows: the share of the day's reps done and a short label. */
export function queueProgress(state: DailyQueueState): { done: number; total: number; fraction: number; label: string } {
  const total = state.order.length;
  const done = Math.min(total, Math.max(0, state.position));
  const left = total - done;
  const label = total === 0 ? "No reps today" : left === 0 ? "All done" : `${left} left`;
  return { done, total, fraction: total === 0 ? 0 : done / total, label };
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
