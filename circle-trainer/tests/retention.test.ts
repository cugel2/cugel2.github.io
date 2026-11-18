import { describe, expect, it } from "vitest";
import { normalizeStoredTrial } from "../src/storage";
import {
  duplicateStrokeIds,
  everTrophyIds,
  looseStrokes,
  oldLooseStrokeIds,
  pruneTrial,
  RAW_SAMPLE_DAYS,
  strokeIdsInTrials,
  trialSampleCount,
  trialsToPrune,
} from "../src/core/retention";
import { bestTrialsByExercise } from "../src/core/trophies";
import type { BoxTrialRecord, ExerciseType, RawStroke, SingleStrokeTrialRecord, TrialRecord } from "../src/core/types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 11, 20);

function stroke(id: string, at: number, samples = 5): RawStroke {
  return {
    id, pointerType: "pen", startedAtEpochMs: at, completedAtEpochMs: at + 100, cancelled: false,
    samples: Array.from({ length: samples }, (_, index) => ({ xCss: index, yCss: index * 2, tMs: index * 8, pressure: 0.3, sourceEventType: "pointermove" as const })),
  };
}

function trial(id: string, exerciseType: ExerciseType, daysAgo: number, score?: number): TrialRecord {
  const at = NOW - daysAgo * DAY;
  const base = {
    id, appVersion: "0.15.2", metricVersion: "m", scoringVersion: "s", createdAtEpochMs: at, practiceMode: exerciseType,
    correctionGateEnabled: false, schedule: { mode: exerciseType, sessionSeed: "s", sequenceIndex: 0, cycleIndex: 0 }, calibrationId: null,
    derived: { metrics: { normalizedError: 0.1 }, executionPassed: score !== undefined, accuracyScore: score },
  };
  if (exerciseType === "BOX") {
    return { ...base, exerciseType, target: { kind: "BOX" }, rawStrokes: [stroke(`${id}-a`, at), stroke(`${id}-b`, at + 1000, 7)] } as unknown as BoxTrialRecord;
  }
  return { ...base, exerciseType, target: { kind: exerciseType }, rawStroke: stroke(`${id}-s`, at) } as unknown as SingleStrokeTrialRecord;
}

describe("trophies past and present", () => {
  it("includes every trial that was the best when it was drawn, and today's trophies", () => {
    const trials = [
      trial("l1", "LINE", 60, 50), trial("l2", "LINE", 50, 70), trial("l3", "LINE", 40, 70), trial("l4", "LINE", 35, 60),
      trial("l5", "LINE", 5, 90), trial("unscored", "LINE", 70), trial("b1", "BOX", 45, 20),
    ];
    const ids = everTrophyIds(trials);
    expect([...ids].sort()).toEqual(["b1", "l1", "l2", "l5"]);
    // A tie keeps the earlier trophy (l3 ties l2 and never was one), as in the trophy case.
    for (const best of Object.values(bestTrialsByExercise(trials))) expect(ids.has(best!.id)).toBe(true);
  });

  it("does not depend on the order the trials are given in", () => {
    const trials = [trial("a", "ARC", 10, 80), trial("b", "ARC", 40, 60)];
    expect([...everTrophyIds(trials)].sort()).toEqual(["a", "b"]);
  });
});

describe("what gets trimmed", () => {
  const trials = [
    trial("old-plain", "CIRCLE", 45, 40),
    trial("old-trophy", "CIRCLE", 50, 80),
    trial("old-unscored", "TAPER", 40),
    trial("old-box", "BOX", 31, 10),
    trial("old-box-trophy", "BOX", 60, 30),
    trial("recent", "CIRCLE", 29, 20),
  ];

  it(`only trials older than ${RAW_SAMPLE_DAYS} days that never were a trophy`, () => {
    expect(trialsToPrune(trials, NOW, NOW).map((each) => each.id).sort()).toEqual(["old-box", "old-plain", "old-unscored"]);
  });

  it("only what the export contains", () => {
    expect(trialsToPrune(trials, NOW, NOW - 42 * DAY).map((each) => each.id)).toEqual(["old-plain"]);
  });

  it("never trims a trial twice", () => {
    const done = trialsToPrune(trials, NOW, NOW).map(pruneTrial);
    const after = trials.map((each) => done.find((pruned) => pruned.id === each.id) ?? each);
    expect(trialsToPrune(after, NOW, NOW)).toEqual([]);
  });

  it("removes only the samples: score, target, versions and stroke records stay", () => {
    for (const original of trials) {
      const pruned = pruneTrial(original);
      expect(pruned.samplesPruned).toBe(true);
      expect(trialSampleCount(pruned)).toBe(0);
      const { rawStroke: _a, rawStrokes: _b, samplesPruned: _c, ...rest } = pruned as TrialRecord & { rawStroke?: unknown; rawStrokes?: unknown };
      const { rawStroke: _d, rawStrokes: _e, ...originalRest } = original as TrialRecord & { rawStroke?: unknown; rawStrokes?: unknown };
      expect(rest).toEqual(originalRest);
      const strokesOf = (record: TrialRecord) => (record.exerciseType === "BOX" ? record.rawStrokes : [record.rawStroke]);
      expect(strokesOf(pruned).map(({ samples: _s, ...meta }) => meta)).toEqual(strokesOf(original).map(({ samples: _s, ...meta }) => meta));
    }
  });

  it("does not change the trial it is given", () => {
    const original = trial("x", "BOX", 40, 10);
    const before = JSON.stringify(original);
    pruneTrial(original);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("a trimmed trial reads back unchanged and still counts for the trophy case", () => {
    const pruned = pruneTrial(trial("p", "ELLIPSE", 40, 55));
    expect(normalizeStoredTrial(pruned, 0)).toEqual(pruned);
    expect(bestTrialsByExercise([pruned]).ELLIPSE?.id).toBe("p");
  });
});

describe("each stroke once", () => {
  const trials = [trial("t1", "LINE", 40, 50), trial("t2", "BOX", 2, 50)];
  const inTrials = strokeIdsInTrials(trials);
  const store = [
    stroke("t1-s", NOW - 40 * DAY), stroke("t2-a", NOW - 2 * DAY), stroke("t2-b", NOW - 2 * DAY),
    stroke("loose-old", NOW - 45 * DAY), stroke("loose-new", NOW - 3 * DAY),
  ];

  it("finds every stroke held inside a trial", () => {
    expect([...inTrials].sort()).toEqual(["t1-s", "t2-a", "t2-b"]);
  });

  it("the strokes store's copies of trial strokes are spare", () => {
    expect(duplicateStrokeIds(store, inTrials)).toEqual(["t1-s", "t2-a", "t2-b"]);
  });

  it("the export lists only strokes with no trial", () => {
    expect(looseStrokes(store, inTrials).map((each) => each.id)).toEqual(["loose-old", "loose-new"]);
  });

  it("loose strokes are removed only when old and in the export", () => {
    expect(oldLooseStrokeIds(store, inTrials, NOW, NOW)).toEqual(["loose-old"]);
    expect(oldLooseStrokeIds(store, inTrials, NOW, NOW - 50 * DAY)).toEqual([]);
  });
});
