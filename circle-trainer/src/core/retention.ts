import type { ExerciseType, RawStroke, TrialRecord } from "./types";

/**
 * What practice data is kept, since 0.15.3. Every trial record is kept for good (target, metrics, score,
 * versions, schedule): score history matters for tuning and the form-ladder gates. Raw Pencil samples are the
 * bulk of the data, so they are kept for RAW_SAMPLE_DAYS days, and for good for every trial that is or has ever
 * been a trophy (the trophy case redraws them). An older trial keeps its stroke records (ids, times, pointer
 * type) with an empty sample list and is marked `samplesPruned`. Scores are never recomputed.
 *
 * Trimming is one-way, so it happens only right after a JSON export, and only once the user confirms the file was
 * saved: it then touches only data created before that export (`backupAtMs`), which the file contains.
 *
 * Each stroke is stored once: inside its trial. The separate `strokes` store keeps only strokes that belong to no
 * trial (interrupted ones); its copies of trial strokes are removed at startup (nothing is lost: the trial has it).
 */
export const RAW_SAMPLE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Trials that are, or at some point were, the best attempt at their exercise (the trophy rule, replayed in time order). */
export function everTrophyIds(trials: readonly TrialRecord[]): Set<string> {
  const ordered = [...trials].sort((a, b) => a.createdAtEpochMs - b.createdAtEpochMs);
  const best: Partial<Record<ExerciseType, number>> = {};
  const ids = new Set<string>();
  for (const trial of ordered) {
    const score = trial.derived.accuracyScore;
    if (!trial.derived.executionPassed || score === undefined) continue;
    // Ties go to the earliest trial (as in bestTrialsByExercise), so only a strictly higher score takes over.
    if (score > (best[trial.exerciseType] ?? -1)) {
      best[trial.exerciseType] = score;
      ids.add(trial.id);
    }
  }
  return ids;
}

export function trialStrokes(trial: TrialRecord): RawStroke[] {
  return trial.exerciseType === "BOX" ? trial.rawStrokes : [trial.rawStroke];
}

export function trialSampleCount(trial: TrialRecord): number {
  return trialStrokes(trial).reduce((sum, stroke) => sum + stroke.samples.length, 0);
}

/** Trials whose raw samples can be trimmed, given a saved backup taken at backupAtMs. */
export function trialsToPrune(trials: readonly TrialRecord[], nowMs: number, backupAtMs: number): TrialRecord[] {
  const cutoff = Math.min(backupAtMs, nowMs - RAW_SAMPLE_DAYS * DAY_MS);
  const keep = everTrophyIds(trials);
  return trials.filter((trial) => trial.createdAtEpochMs < cutoff && !keep.has(trial.id) && !trial.samplesPruned && trialSampleCount(trial) > 0);
}

/** The trial without its raw samples; everything else is unchanged. */
export function pruneTrial(trial: TrialRecord): TrialRecord {
  const empty = (stroke: RawStroke): RawStroke => ({ ...stroke, samples: [] });
  if (trial.exerciseType === "BOX") return { ...trial, rawStrokes: trial.rawStrokes.map(empty), samplesPruned: true };
  return { ...trial, rawStroke: empty(trial.rawStroke), samplesPruned: true };
}

/** Ids of every stroke held inside a trial. */
export function strokeIdsInTrials(trials: readonly TrialRecord[]): Set<string> {
  return new Set(trials.flatMap((trial) => trialStrokes(trial).map((stroke) => stroke.id)));
}

/** Strokes-store entries that are copies of strokes inside a trial: removing them loses nothing. */
export function duplicateStrokeIds(strokes: ReadonlyArray<Pick<RawStroke, "id">>, inTrials: ReadonlySet<string>): string[] {
  return strokes.filter((stroke) => inTrials.has(stroke.id)).map((stroke) => stroke.id);
}

/** Strokes-store entries that belong to no trial and are past RAW_SAMPLE_DAYS, and in the backup taken at backupAtMs. */
export function oldLooseStrokeIds(
  strokes: ReadonlyArray<Pick<RawStroke, "id" | "startedAtEpochMs">>,
  inTrials: ReadonlySet<string>,
  nowMs: number,
  backupAtMs: number,
): string[] {
  const cutoff = Math.min(backupAtMs, nowMs - RAW_SAMPLE_DAYS * DAY_MS);
  return strokes.filter((stroke) => !inTrials.has(stroke.id) && stroke.startedAtEpochMs < cutoff).map((stroke) => stroke.id);
}

/** For the export: only strokes that are not already inside a trial (each stroke appears once). */
export function looseStrokes<T extends Pick<RawStroke, "id">>(strokes: readonly T[], inTrials: ReadonlySet<string>): T[] {
  return strokes.filter((stroke) => !inTrials.has(stroke.id));
}
