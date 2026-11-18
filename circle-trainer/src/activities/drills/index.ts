/**
 * The Drills activity (0.17.0): the drill runner, plus the registry views the shell needs (labels, counts, the
 * drill list, trophy drawing). The shell imports drills only from here.
 */
export { mountDrillRunner as mountDrills } from "./runner";
export { ALL_EXERCISE_TYPES, DAILY_COUNTS, drillFor, EXERCISE_LABELS, SECONDS_PER_REP, versionsForExercise } from "./registry";
export type { Mark } from "./types";
