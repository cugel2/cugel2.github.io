/**
 * The one place the golden tests import app code from.
 *
 * The restructure (RESTRUCTURE-PLAN.md) moves these functions between files. When a stage moves one, change
 * only the import path here. The pinned values in tests/golden/data/ must never change: a golden test that
 * fails after a move means the move changed behaviour.
 */
export { generateTarget } from "../../src/core/targets";
export { sampleTargetPathCss } from "../../src/core/targets";
export { analyseTargetStroke } from "../../src/core/primitiveMetrics";
export { versionsForExercise } from "../../src/activities/drills/registry";
export { analyseTaperStroke, taperMetricText, PRESSURE_HIGH, PRESSURE_LOW, WIDTH_MAX_MM, WIDTH_MIN_MM, targetWidthAtMm } from "../../src/core/taper";
export { analyseBoxStrokes } from "../../src/core/boxMetrics";
export { answerCornersMmForSwing, BOX_EDGES, nonHingeEdgeIndices } from "../../src/core/box";
export { ALL_EXERCISE_TYPES, EXERCISE_LABELS, MIXED_EXERCISE_TYPES, MODE_LABELS, PracticeScheduler } from "../../src/core/scheduler";
export {
  buildDailyQueue,
  DAILY_COUNTS,
  dailyMinutes,
  DEFAULT_DAILY_TICKS,
  queueMinutesLeft,
  queueProgress,
  SECONDS_PER_REP,
} from "../../src/core/dailyQueue";
export {
  copyCardAtCheckpoint,
  copyClockState,
  copyTimeText,
  dayFinished,
  emptyMarks,
  lastSevenDays,
  startupMode,
  todayCard,
  type DayInput,
} from "../../src/core/dailyFlow";
export { normalizeStoredTrial } from "../../src/storage";
export { pruneTrial } from "../../src/core/retention";
export { seededRandom } from "../../src/core/random";
export type {
  BoxTarget,
  ExerciseType,
  Handedness,
  LegacyLineTrialRecord,
  Point2,
  PracticeMode,
  RawSample,
  RawStroke,
  TaperTarget,
  TargetDefinition,
  TrialRecord,
} from "../../src/core/types";
