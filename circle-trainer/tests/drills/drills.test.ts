import { describe, expect, it } from "vitest";
import { ALL_EXERCISE_TYPES, DRILLS, drillFor } from "../../src/activities/drills/registry";
import { analyseBoxStrokes } from "../../src/core/boxMetrics";
import { BOX_EDGES, nonHingeEdgeIndices } from "../../src/core/box";
import { analyseTargetStroke } from "../../src/core/primitiveMetrics";
import { generateTarget, sampleTargetPathCss } from "../../src/core/targets";
import type { BoxTarget, ExerciseType, RawStroke, TargetDefinition, TrialRecord } from "../../src/core/types";
import { PX_PER_MM, resample, strokeFrom, VIEWPORTS } from "../golden/fixtures";
import { referenceFeedbackDetails, referenceRedraw, referenceTrialMarks, referenceTrophyMetricText, type ReferenceState } from "./reference-0.15.4";

/** A stand-in 2D context that records every call and property set, so two drawings can be compared exactly. */
function recordingContext(): { g: CanvasRenderingContext2D; log: unknown[] } {
  const log: unknown[] = [];
  const g = new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => (...args: unknown[]) => { log.push([String(key), JSON.parse(JSON.stringify(args))]); },
    set: (_target, key, value) => { log.push(["set", String(key), value]); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { g, log };
}

const SIZE = VIEWPORTS.landscape;

function strokesFor(target: TargetDefinition, seed: string): RawStroke[] {
  if (target.kind === "BOX") {
    return nonHingeEdgeIndices(target.hingeEdgeIndex).map((edge, index) => {
      const [a, b] = BOX_EDGES[edge];
      return strokeFrom(resample([target.answerCornersCss[a], target.answerCornersCss[b]], 20), { seed: `${seed}:${index}`, jitterMm: 0.5, id: `${seed}-${index}` });
    });
  }
  const path = sampleTargetPathCss(target, PX_PER_MM, 120);
  return [strokeFrom(resample(path, 60), {
    seed, jitterMm: 0.4,
    pressure: (index, fraction) => (index === 0 ? 0.08 : index === 59 ? 0 : 0.1 + 0.3 * fraction),
  })];
}

interface Case {
  name: string;
  type: ExerciseType;
  target: TargetDefinition;
  state: ReferenceState["trialState"];
  accepted: RawStroke[];
  active: RawStroke | null;
}

function cases(): Case[] {
  return ALL_EXERCISE_TYPES.flatMap((type) => [0, 1].flatMap((index) => {
    const target = generateTarget(type, SIZE, PX_PER_MM, "drill-equivalence", index, "LEFT");
    const strokes = strokesFor(target, `${type}-${index}`);
    const several = type === "BOX";
    return [
      { name: "ready", type, target, state: "READY" as const, accepted: [], active: null },
      { name: "drawing", type, target, state: "DRAWING" as const, accepted: several ? strokes.slice(0, 4) : [], active: strokes[several ? 4 : 0] },
      { name: "processing", type, target, state: "PROCESSING" as const, accepted: strokes, active: null },
      { name: "feedback", type, target, state: "FEEDBACK" as const, accepted: strokes, active: null },
      ...(several ? [{ name: "part-drawn", type, target, state: "READY" as const, accepted: strokes.slice(0, 6), active: null }] : []),
    ];
  }));
}

describe("drill registry", () => {
  it("lists the seven drills once each, in menu order", () => {
    expect(DRILLS.map((drill) => drill.id)).toEqual(["LINE", "ARC", "CIRCLE", "ELLIPSE", "S_CURVE", "TAPER", "BOX"]);
    expect(() => drillFor("NOPE" as ExerciseType)).toThrow();
  });

  it("keeps the wording the app showed before (0.15.4)", () => {
    expect(DRILLS.map((drill) => [drill.singular, drill.trophyNoun, drill.revealName, drill.strokesRequired, drill.usesCorrectionGate])).toEqual([
      ["line", "line", "ideal path", 1, true],
      ["arc", "arc", "ideal path", 1, true],
      ["circle", "circle", "ideal path", 1, true],
      ["ellipse", "ellipse", "ideal path", 1, true],
      ["s curve", "S curve", "ideal path", 1, true],
      ["taper", "taper", "ideal path", 1, true],
      ["box", "box", "true box", 11, false],
    ]);
    expect(DRILLS.filter((drill) => drill.controls.undo || drill.controls.tips || drill.relayout || drill.acceptStroke).map((drill) => drill.id)).toEqual(["BOX"]);
  });
});

describe("drawing is unchanged from 0.15.4", () => {
  for (const testCase of cases()) {
    it(`${testCase.type} ${testCase.name}`, () => {
      const old = recordingContext();
      const several = testCase.type === "BOX";
      referenceRedraw(old.g, {
        target: testCase.target,
        trialState: testCase.state,
        boxStrokes: several ? testCase.accepted : [],
        activeStroke: testCase.active,
        // One-stroke drills drew `activeStroke ?? completedStroke`; the finished stroke is the accepted one.
        completedStroke: several ? testCase.accepted.at(-1) ?? null : testCase.accepted[0] ?? null,
        targetCanvas: SIZE,
        bounds: SIZE,
        px: PX_PER_MM,
      });
      const now = recordingContext();
      now.g.clearRect(0, 0, SIZE.width, SIZE.height); // the reference's redrawAll clears first; the runner does too
      drillFor(testCase.type).draw(now.g, {
        target: testCase.target, strokes: testCase.accepted, activeStroke: testCase.active,
        feedback: testCase.state === "FEEDBACK", cssPxPerMm: PX_PER_MM, layoutCanvas: SIZE,
      });
      expect(now.log.length).toBeGreaterThan(5);
      expect(now.log).toEqual(old.log);
    });
  }
});

describe("feedback and trophy text and trophy drawings are unchanged from 0.15.4", () => {
  const trials: TrialRecord[] = ALL_EXERCISE_TYPES.flatMap((type) => [0, 1, 2].map((index) => {
    const target = generateTarget(type, SIZE, PX_PER_MM, "drill-text", index, "LEFT");
    const strokes = strokesFor(target, `text-${type}-${index}`);
    const derived = target.kind === "BOX" ? analyseBoxStrokes(strokes, target as BoxTarget, PX_PER_MM) : analyseTargetStroke(strokes[0], target, PX_PER_MM, false);
    const base = {
      id: `${type}-${index}`, appVersion: "0.15.4", metricVersion: "m", scoringVersion: "s", createdAtEpochMs: 1_700_000_000_000 + index,
      exerciseType: type, practiceMode: type, correctionGateEnabled: false, schedule: { mode: type, sessionSeed: "s", sequenceIndex: index, cycleIndex: 0 },
      calibrationId: null, target, derived,
    };
    return (type === "BOX" ? { ...base, rawStrokes: strokes } : { ...base, rawStroke: strokes[0] }) as TrialRecord;
  }));

  it("has scored and unscored-but-measured cases for every drill", () => {
    for (const type of ALL_EXERCISE_TYPES) expect(trials.some((trial) => trial.exerciseType === type && trial.derived.executionPassed)).toBe(true);
  });

  for (const trial of trials) {
    it(trial.id, () => {
      const drill = drillFor(trial.exerciseType);
      if (trial.derived.executionPassed) expect(drill.feedbackText(trial.derived.metrics)).toBe(referenceFeedbackDetails(trial.exerciseType, trial.derived));
      expect(drill.trophyText(trial.derived.metrics)).toBe(referenceTrophyMetricText(trial));
      expect(drill.trophyMarks(trial, PX_PER_MM)).toEqual(referenceTrialMarks(trial, PX_PER_MM));
    });
  }
});
