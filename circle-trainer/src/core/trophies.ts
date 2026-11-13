import { ALL_EXERCISE_TYPES } from "./scheduler";
import type { ExerciseType, TrialRecord } from "./types";

export type TrophyCase = Partial<Record<ExerciseType, TrialRecord>>;

/**
 * The best scored trial for each exercise. Unscored trials (failed execution gate) never count.
 * Ties go to the earliest trial that reached the score. Mixed-mode trials count for their exercise.
 */
export function bestTrialsByExercise(trials: readonly TrialRecord[]): TrophyCase {
  const best: TrophyCase = {};
  for (const trial of trials) {
    const score = trial.derived.accuracyScore;
    if (!trial.derived.executionPassed || score === undefined) continue;
    const current = best[trial.exerciseType];
    const currentScore = current?.derived.accuracyScore ?? -1;
    if (!current || score > currentScore || (score === currentScore && trial.createdAtEpochMs < current.createdAtEpochMs)) {
      best[trial.exerciseType] = trial;
    }
  }
  return best;
}

export const TROPHY_ORDER: readonly ExerciseType[] = ALL_EXERCISE_TYPES;
