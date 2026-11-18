import type { ExerciseType, TargetDefinition } from "../../core/types";
import { BOX_DRILL } from "./box";
import { ARC_DRILL, CIRCLE_DRILL, ELLIPSE_DRILL, LINE_DRILL, S_CURVE_DRILL } from "./primitives";
import { TAPER_DRILL } from "./taper";
import type { Drill } from "./types";

/**
 * Every drill, in menu order (also the order of the Today ticks, the trophy case and the Data sheet).
 * Adding a drill: add its id to ExerciseType in core/types.ts, add its folder here, and add it to this list.
 */
export const DRILLS: readonly Drill[] = [
  LINE_DRILL,
  ARC_DRILL,
  CIRCLE_DRILL,
  ELLIPSE_DRILL,
  S_CURVE_DRILL,
  TAPER_DRILL,
  BOX_DRILL,
] as unknown as readonly Drill[];

const BY_ID = new Map<ExerciseType, Drill>(DRILLS.map((drill) => [drill.id, drill]));

export function drillFor(id: ExerciseType): Drill<TargetDefinition> {
  const drill = BY_ID.get(id);
  if (!drill) throw new Error(`Unknown drill: ${id}`);
  return drill;
}

/* ---------- views over the registry (same names and values as before 0.16.0) ---------- */

export const ALL_EXERCISE_TYPES: readonly ExerciseType[] = DRILLS.map((drill) => drill.id);

const byDrill = <V>(value: (drill: Drill) => V) => Object.fromEntries(DRILLS.map((drill) => [drill.id, value(drill)])) as Record<ExerciseType, V>;

export const EXERCISE_LABELS: Record<ExerciseType, string> = byDrill((drill) => drill.label);
/** Reps per ticked mode in Today. */
export const DAILY_COUNTS: Record<ExerciseType, number> = byDrill((drill) => drill.today.count);
/** Rough seconds per attempt, used only for the "about N min" estimate. */
export const SECONDS_PER_REP: Record<ExerciseType, number> = byDrill((drill) => drill.today.secondsPerRep);

export function versionsForExercise(type: ExerciseType): { metric: string; scoring: string } {
  return drillFor(type).versions;
}
