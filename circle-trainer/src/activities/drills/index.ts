/**
 * The Drills activity (0.17.0): the drill runner, plus the registry views the shell needs (labels, counts, the
 * drill list, trophy drawing). The shell imports drills only from here.
 */
export { mountDrillRunner as mountDrills } from "./runner";
export { ALL_EXERCISE_TYPES, DAILY_COUNTS, drillFor, EXERCISE_LABELS, SECONDS_PER_REP, versionsForExercise } from "./registry";
export type { Mark } from "./types";

import type { OffersToday } from "../types";
import { DRILLS } from "./registry";

/** Reps of every ticked drill, in menu order, at its Today count. */
export const todayParts: OffersToday = (settings) => DRILLS
  .filter((drill) => settings.ticks.includes(drill.id))
  .map((drill) => ({ kind: "REPS" as const, unitId: drill.id, label: drill.label, count: drill.today.count, secondsPerRep: drill.today.secondsPerRep }));
