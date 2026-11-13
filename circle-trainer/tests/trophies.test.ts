import { describe, expect, it } from "vitest";
import { bestTrialsByExercise } from "../src/core/trophies";
import type { ExerciseType, PracticeMode, TrialRecord } from "../src/core/types";

function trial(id: string, exerciseType: ExerciseType, score: number | undefined, createdAtEpochMs: number, practiceMode: PracticeMode = exerciseType): TrialRecord {
  return {
    id,
    appVersion: "test",
    metricVersion: "m",
    scoringVersion: "s",
    createdAtEpochMs,
    exerciseType,
    practiceMode,
    correctionGateEnabled: false,
    schedule: { mode: practiceMode, sessionSeed: "seed", sequenceIndex: 0, cycleIndex: 0 },
    calibrationId: null,
    // Only the fields the trophy case reads matter here.
    derived: { metrics: {}, executionPassed: score !== undefined, accuracyScore: score },
  } as unknown as TrialRecord;
}

describe("trophy case", () => {
  it("picks the highest score per exercise, earliest on ties, ignoring unscored trials", () => {
    const best = bestTrialsByExercise([
      trial("line-80", "LINE", 80, 1),
      trial("line-92-late", "LINE", 92, 5),
      trial("line-92-early", "LINE", 92, 3),
      trial("line-unscored", "LINE", undefined, 4),
      trial("box-61", "BOX", 61, 2),
      trial("arc-mixed", "ARC", 70, 6, "MIXED_RANDOM"),
      trial("circle-unscored", "CIRCLE", undefined, 7),
    ]);
    expect(best.LINE?.id).toBe("line-92-early");
    expect(best.BOX?.id).toBe("box-61");
    expect(best.ARC?.id).toBe("arc-mixed");
    expect(best.CIRCLE).toBeUndefined();
    expect(best.ELLIPSE).toBeUndefined();
  });

  it("counts a score of zero as a trophy", () => {
    expect(bestTrialsByExercise([trial("zero", "S_CURVE", 0, 1)]).S_CURVE?.id).toBe("zero");
  });
});
