import { describe, expect, it } from "vitest";
import {
  ALL_EXERCISE_TYPES,
  DAILY_COUNTS,
  DEFAULT_DAILY_TICKS,
  EXERCISE_LABELS,
  generateTarget,
  MIXED_EXERCISE_TYPES,
  MODE_LABELS,
  PracticeScheduler,
  SECONDS_PER_REP,
  versionsForExercise,
  type ExerciseType,
  type Handedness,
  type PracticeMode,
} from "./api";
import { expectGolden } from "./golden";
import { PX_PER_MM, VIEWPORTS } from "./fixtures";

const SEEDS = ["golden-a", "golden-b"];
const INDICES = [0, 1, 2];

function targetsFor(type: ExerciseType, viewport: { width: number; height: number }, handedness?: Handedness) {
  return SEEDS.flatMap((seed) => INDICES.map((index) => ({
    seed,
    index,
    target: generateTarget(type, viewport, PX_PER_MM, seed, index, handedness),
  })));
}

describe("golden: generated targets", () => {
  it("covers all seven drills", () => {
    expect([...ALL_EXERCISE_TYPES]).toEqual(["LINE", "ARC", "CIRCLE", "ELLIPSE", "S_CURVE", "TAPER", "BOX"]);
  });

  for (const type of ["LINE", "ARC", "CIRCLE", "ELLIPSE", "S_CURVE", "TAPER"] as const) {
    it(`${type}: landscape, portrait and a tiny canvas (fallback)`, () => {
      expectGolden(`targets-${type}`, {
        landscape: targetsFor(type, VIEWPORTS.landscape),
        portrait: targetsFor(type, VIEWPORTS.portrait),
        tiny: generateTarget(type, VIEWPORTS.tiny, PX_PER_MM, "golden-a", 0),
      });
    });
  }

  it("BOX: both hands, landscape and portrait, and the fallback", () => {
    expectGolden("targets-BOX", {
      landscapeLeft: targetsFor("BOX", VIEWPORTS.landscape, "LEFT"),
      landscapeRight: targetsFor("BOX", VIEWPORTS.landscape, "RIGHT"),
      portraitLeft: targetsFor("BOX", VIEWPORTS.portrait, "LEFT"),
      landscapeDefaultHand: generateTarget("BOX", VIEWPORTS.landscape, PX_PER_MM, "golden-a", 0),
      tiny: generateTarget("BOX", VIEWPORTS.tiny, PX_PER_MM, "golden-a", 0, "LEFT"),
    });
  });

  it("the default hand for a box is LEFT", () => {
    expect(generateTarget("BOX", VIEWPORTS.landscape, PX_PER_MM, "golden-a", 0))
      .toEqual(generateTarget("BOX", VIEWPORTS.landscape, PX_PER_MM, "golden-a", 0, "LEFT"));
  });
});

describe("golden: per-drill constants and schedules", () => {
  it("labels, versions, daily counts and seconds per rep", () => {
    expectGolden("drill-constants", {
      allExerciseTypes: ALL_EXERCISE_TYPES,
      mixedExerciseTypes: MIXED_EXERCISE_TYPES,
      exerciseLabels: EXERCISE_LABELS,
      modeLabels: MODE_LABELS,
      versions: Object.fromEntries(ALL_EXERCISE_TYPES.map((type) => [type, versionsForExercise(type)])),
      dailyCounts: DAILY_COUNTS,
      secondsPerRep: SECONDS_PER_REP,
      defaultDailyTicks: DEFAULT_DAILY_TICKS,
    });
  });

  it("the exercise sequence and schedule context of every practice mode, including the retired Mixed modes", () => {
    const modes: PracticeMode[] = [...ALL_EXERCISE_TYPES, "MIXED_BLOCKED", "MIXED_RANDOM", "TODAY"];
    const runs = Object.fromEntries(modes.map((mode) => {
      const scheduler = new PracticeScheduler(mode, "golden-session");
      const steps = Array.from({ length: mode === "MIXED_BLOCKED" ? 90 : 12 }, () => {
        const step = { exercise: scheduler.currentExercise(), context: scheduler.context(), block: scheduler.blockProgress() };
        scheduler.advance();
        return step;
      });
      return [mode, steps];
    }));
    expectGolden("schedules", runs);
  });
});
