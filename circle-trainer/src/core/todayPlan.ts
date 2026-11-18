import type { ExerciseType } from "./types";

/**
 * Today is planned from what the activities offer (since 0.18.0). Each activity offers parts:
 * - REPS: a number of reps of one drill (Drills offer one per ticked drill).
 * - TIMED: minutes of an untimed-by-reps activity (Copy offers its Copy time).
 * The day is all REPS parts, interleaved into one queue (dailyQueue.ts), then the TIMED parts in the order the
 * activities are listed. With today's two activities this is exactly the queue and the drills-then-Copy flow of
 * 0.12.0–0.17.0.
 */
export type TodayPart =
  | { kind: "REPS"; unitId: ExerciseType; label: string; count: number; secondsPerRep: number }
  | { kind: "TIMED"; unitId: string; label: string; minutes: number };

export type RepsPart = Extract<TodayPart, { kind: "REPS" }>;
export type TimedPart = Extract<TodayPart, { kind: "TIMED" }>;

/** The standing Today settings activities read their parts from. */
export interface TodaySettings {
  /** Drills ticked for Today. */
  ticks: readonly ExerciseType[];
  /** Minutes per day for each timed unit (e.g. COPY); 0 or missing is Off. */
  minutes: Readonly<Record<string, number>>;
}

export interface DayPlan {
  /** Reps per drill, in the order offered (the order the interleaving starts from). */
  reps: ReadonlyMap<ExerciseType, number>;
  /** Rough seconds for all the reps, for the "about N min" estimate. */
  repSeconds: number;
  /** Timed parts with time, in the order of the day. */
  timed: readonly TimedPart[];
}

/** The day from every activity's parts, listed in the order of the day. Empty parts are left out. */
export function planDay(parts: readonly TodayPart[]): DayPlan {
  const reps = new Map<ExerciseType, number>();
  let repSeconds = 0;
  const timed: TimedPart[] = [];
  for (const part of parts) {
    if (part.kind === "REPS") {
      if (part.count <= 0) continue;
      reps.set(part.unitId, (reps.get(part.unitId) ?? 0) + part.count);
      repSeconds += part.count * part.secondsPerRep;
    } else if (part.minutes > 0) {
      timed.push(part);
    }
  }
  return { reps, repSeconds, timed };
}

/** Whole minutes of reps, rounded (the Settings estimate). */
export function planRepMinutes(plan: DayPlan): number {
  return Math.round(plan.repSeconds / 60);
}

/** Minutes of one timed unit in the plan; 0 when it is Off or not offered. */
export function timedMinutes(plan: DayPlan, unitId: string): number {
  return plan.timed.find((part) => part.unitId === unitId)?.minutes ?? 0;
}
