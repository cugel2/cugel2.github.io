import { describe, expect, it } from "vitest";
import { COPY_UNIT, todayParts as copyTodayParts } from "../src/activities/copy";
import { ALL_EXERCISE_TYPES, todayParts as drillsTodayParts } from "../src/activities/drills";
import {
  buildDailyQueue,
  buildQueueFromCounts,
  dailyMinutes,
  DEFAULT_DAILY_TICKS,
  ensureQueueForCounts,
  ensureTodayQueue,
  requeueForCounts,
  requeueForTicks,
} from "../src/core/dailyQueue";
import { planDay, planRepMinutes, timedMinutes, type TodayPart } from "../src/core/todayPlan";
import type { ExerciseType } from "../src/core/types";

const TICK_SETS: ReadonlyArray<readonly ExerciseType[]> = [
  DEFAULT_DAILY_TICKS,
  ALL_EXERCISE_TYPES,
  ["LINE"],
  ["BOX", "LINE"],
  ["ARC", "S_CURVE", "TAPER"],
  ["BOX", "LINE", "BOX", "UNKNOWN" as ExerciseType],
  [],
];
const DAYS = ["2026-11-16", "2026-11-17", "2027-01-01", "2026-03-29"];

/** The shell's plan: Drills, then Copy, as in shell/today.ts. */
function plan(ticks: readonly ExerciseType[], copyMinutes: number) {
  const settings = { ticks, minutes: { [COPY_UNIT]: copyMinutes } };
  return planDay([...drillsTodayParts(settings), ...copyTodayParts(settings)]);
}

describe("Today from the activities' parts gives the same day as before (0.17.0)", () => {
  for (const ticks of TICK_SETS) {
    it(`ticks ${ticks.join(",") || "none"}`, () => {
      const planned = plan(ticks, 30);
      for (const day of DAYS) expect(buildQueueFromCounts(day, planned.reps)).toEqual(buildDailyQueue(day, ticks));
      expect(planRepMinutes(planned)).toBe(dailyMinutes(ticks));
    });
  }

  it("rebuilds, keeps and requeues exactly as the tick-based functions", () => {
    const now = new Date(2026, 10, 17, 12).getTime();
    const counts = plan(DEFAULT_DAILY_TICKS, 30).reps;
    const fresh = ensureTodayQueue(null, DEFAULT_DAILY_TICKS, now);
    expect(ensureQueueForCounts(null, counts, now)).toEqual(fresh);
    const started = { ...fresh, position: 3 };
    expect(ensureQueueForCounts(started, counts, now)).toBe(started);
    expect(requeueForCounts(started, plan(["LINE"], 30).reps, now)).toEqual(requeueForTicks(started, ["LINE"], now));
    expect(requeueForCounts(fresh, plan(["LINE"], 30).reps, now)).toEqual(requeueForTicks(fresh, ["LINE"], now));
    const yesterday = { ...fresh, dayKey: "2026-11-16", position: 5 };
    expect(ensureQueueForCounts(yesterday, counts, now)).toEqual(ensureTodayQueue(yesterday, DEFAULT_DAILY_TICKS, now));
  });

  it("Copy offers its minutes as the one timed part, and nothing when Off", () => {
    for (const minutes of [0, 15, 30, 45, 60]) {
      const planned = plan(DEFAULT_DAILY_TICKS, minutes);
      expect(timedMinutes(planned, COPY_UNIT)).toBe(minutes);
      expect(planned.timed.length).toBe(minutes > 0 ? 1 : 0);
    }
    expect(copyTodayParts({ ticks: [], minutes: { [COPY_UNIT]: 30 } })).toEqual([{ kind: "TIMED", unitId: "COPY", label: "Copy", minutes: 30 }]);
  });

  it("Drills offer each ticked drill in menu order with its count and pace", () => {
    expect(drillsTodayParts({ ticks: ["BOX", "LINE"], minutes: {} })).toEqual([
      { kind: "REPS", unitId: "LINE", label: "Lines", count: 40, secondsPerRep: 3 },
      { kind: "REPS", unitId: "BOX", label: "Boxes", count: 10, secondsPerRep: 30 },
    ]);
  });
});

describe("the day planner", () => {
  it("keeps reps in the order offered, timed parts in order, and leaves out empty parts", () => {
    const parts: TodayPart[] = [
      { kind: "REPS", unitId: "CIRCLE", label: "Circles", count: 24, secondsPerRep: 5 },
      { kind: "TIMED", unitId: "GESTURE", label: "Gesture", minutes: 25 },
      { kind: "REPS", unitId: "LINE", label: "Lines", count: 0, secondsPerRep: 3 },
      { kind: "REPS", unitId: "BOX", label: "Boxes", count: 10, secondsPerRep: 30 },
      { kind: "TIMED", unitId: "MEMORY", label: "Memory", minutes: 0 },
      { kind: "TIMED", unitId: "COPY", label: "Copy", minutes: 20 },
    ];
    const planned = planDay(parts);
    expect([...planned.reps]).toEqual([["CIRCLE", 24], ["BOX", 10]]);
    expect(planned.repSeconds).toBe(24 * 5 + 10 * 30);
    expect(planned.timed.map((part) => part.unitId)).toEqual(["GESTURE", "COPY"]);
    expect(timedMinutes(planned, "MEMORY")).toBe(0);
  });
});
