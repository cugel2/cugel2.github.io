import { describe, expect, it } from "vitest";
import {
  ALL_EXERCISE_TYPES,
  generateTarget,
  normalizeStoredTrial,
  sampleTargetPathCss,
  type ExerciseType,
  type LegacyLineTrialRecord,
  type PracticeMode,
  type TrialRecord,
} from "./api";
import { expectGolden } from "./golden";
import { PX_PER_MM, resample, strokeFrom, VIEWPORTS } from "./fixtures";

/**
 * Stored trial records as the app has written them over its versions: every exercise type, every practice mode
 * a trial can carry (including the retired MIXED_BLOCKED and MIXED_RANDOM), records from before the correction
 * gate existed, and a 0.2 line record with no exerciseType. All synthetic; never John's exports.
 */
function record(exerciseType: ExerciseType, practiceMode: PracticeMode, index: number, gate: boolean | undefined): TrialRecord {
  const target = generateTarget(exerciseType, VIEWPORTS.landscape, PX_PER_MM, "golden-storage", index, "LEFT");
  const stroke = strokeFrom(resample(sampleTargetPathCss(target, PX_PER_MM, 40), 6), { seed: `storage-${index}` });
  const base = {
    id: `trial-${exerciseType}-${practiceMode}-${index}`,
    appVersion: "0.14.2",
    metricVersion: `${exerciseType.toLowerCase()}-metric`,
    scoringVersion: `${exerciseType.toLowerCase()}-scoring`,
    createdAtEpochMs: 1_760_000_000_000 + index * 1_000,
    practiceMode,
    schedule: practiceMode === "MIXED_BLOCKED"
      ? { mode: practiceMode, sessionSeed: "s", sequenceIndex: index, cycleIndex: 0, blockIndex: 1, positionInBlock: 3 }
      : { mode: practiceMode, sessionSeed: "s", sequenceIndex: index, cycleIndex: 0 },
    calibrationId: index % 2 === 0 ? "calibration-1" : null,
    ...(gate === undefined ? {} : { correctionGateEnabled: gate }),
  };
  const derived = { metrics: { normalizedError: 0.1 * index }, executionPassed: index % 3 !== 0, accuracyScore: index % 3 !== 0 ? 50 + index : undefined };
  if (exerciseType === "BOX") {
    return { ...base, exerciseType, target, rawStrokes: [stroke, { ...stroke, id: `${stroke.id}-2` }], derived } as unknown as TrialRecord;
  }
  return { ...base, exerciseType, target, rawStroke: stroke, derived } as unknown as TrialRecord;
}

function storedSet(): Array<TrialRecord | LegacyLineTrialRecord> {
  const records: Array<TrialRecord | LegacyLineTrialRecord> = [];
  let index = 0;
  for (const type of ALL_EXERCISE_TYPES) {
    records.push(record(type, type, index++, true));
    records.push(record(type, "TODAY", index++, false));
    records.push(record(type, type, index++, undefined));
  }
  for (const type of ["LINE", "ARC", "CIRCLE", "ELLIPSE"] as const) {
    records.push(record(type, "MIXED_BLOCKED", index++, true));
    records.push(record(type, "MIXED_RANDOM", index++, undefined));
  }
  records.push({
    id: "legacy-line",
    appVersion: "0.2.0",
    metricVersion: "line-1",
    scoringVersion: "line-1",
    createdAtEpochMs: 1_700_000_000_000,
    target: { kind: "LINE", aCss: { x: 100, y: 100 }, bCss: { x: 600, y: 140 }, lengthMm: 96.4 },
    rawStroke: strokeFrom([{ x: 100, y: 100 }, { x: 350, y: 121 }, { x: 600, y: 140 }], { seed: "legacy" }),
    calibrationId: null,
    derived: {
      metrics: {
        endpointStartErrorMm: 0.4, endpointEndErrorMm: 0.6, endpointMeanErrorMm: 0.5,
        rmsOrthogonalDeviationMm: 0.7, maxOrthogonalDeviationMm: 1.3, pathLengthMm: 96.6,
        pathEfficiency: 0.998, totalTurningRad: 0.05, durationMs: 420,
        meanSpeedMmS: 230, normalizedError: 0.012,
      },
      executionPassed: true,
      accuracyScore: 88,
    },
  });
  return records;
}

describe("golden: stored trial records (normalizeStoredTrial)", () => {
  it("covers every exercise type and the retired Mixed modes", () => {
    const records = storedSet().filter((trial): trial is TrialRecord => "exerciseType" in trial);
    expect(new Set(records.map((trial) => trial.exerciseType))).toEqual(new Set(ALL_EXERCISE_TYPES));
    expect(new Set(records.map((trial) => trial.practiceMode))).toEqual(new Set([...ALL_EXERCISE_TYPES, "TODAY", "MIXED_BLOCKED", "MIXED_RANDOM"]));
  });

  it("keeps every stored field and value; only a missing gate flag becomes true", () => {
    storedSet().forEach((trial, index) => {
      if (!("exerciseType" in trial)) return;
      const normalized = normalizeStoredTrial(trial, index);
      const expected = { ...trial, correctionGateEnabled: trial.correctionGateEnabled ?? true };
      expect(normalized).toEqual(expected);
      expect(Object.keys(normalized).sort()).toEqual(Object.keys(expected).sort());
    });
  });

  it("gives a 0.2 line record its exercise, mode and schedule without touching its score", () => {
    const legacy = storedSet().at(-1)!;
    const normalized = normalizeStoredTrial(legacy, 41);
    expect(normalized.exerciseType).toBe("LINE");
    expect(normalized.practiceMode).toBe("LINE");
    expect(normalized.schedule).toEqual({ mode: "LINE", sessionSeed: "legacy-line-session", sequenceIndex: 41, cycleIndex: 0 });
    expect(normalized.derived).toEqual(legacy.derived);
    expect(normalized.scoringVersion).toBe("line-1");
  });

  it("the whole normalised set", () => {
    expectGolden("storage-normalized", storedSet().map((trial, index) => normalizeStoredTrial(trial, index)));
  });

  it("does not change the record it is given", () => {
    const records = storedSet();
    const before = JSON.stringify(records);
    records.forEach((trial, index) => normalizeStoredTrial(trial, index));
    expect(JSON.stringify(records)).toBe(before);
  });
});
