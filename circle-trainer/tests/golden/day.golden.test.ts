import { describe, it } from "vitest";
import {
  ALL_EXERCISE_TYPES,
  buildDailyQueue,
  copyCardAtCheckpoint,
  copyClockState,
  copyTimeText,
  dailyMinutes,
  dayFinished,
  DEFAULT_DAILY_TICKS,
  emptyMarks,
  lastSevenDays,
  queueMinutesLeft,
  queueProgress,
  startupMode,
  todayCard,
  type DayInput,
  type ExerciseType,
  type PracticeMode,
} from "./api";
import { expectGolden } from "./golden";

const DAY = "2026-11-16";

const TICK_SETS: Record<string, readonly ExerciseType[]> = {
  default: DEFAULT_DAILY_TICKS,
  all: ALL_EXERCISE_TYPES,
  linesOnly: ["LINE"],
  linesAndBoxes: ["LINE", "BOX"],
  shapesAndTapers: ["ARC", "S_CURVE", "TAPER"],
  unordered: ["BOX", "LINE", "BOX", "UNKNOWN" as ExerciseType],
  nothing: [],
};

describe("golden: Today's queue", () => {
  it("order, progress and minutes for fixed ticks on a fixed day", () => {
    const result = Object.fromEntries(Object.entries(TICK_SETS).map(([name, ticks]) => {
      const queue = buildDailyQueue(DAY, ticks);
      const checkpoints = [0, 1, Math.floor(queue.order.length / 2), queue.order.length - 1, queue.order.length]
        .filter((position) => position >= 0)
        .map((position) => {
          const state = { ...queue, position };
          return { position, progress: queueProgress(state), minutesLeft: queueMinutesLeft(state) };
        });
      return [name, { queue, dailyMinutes: dailyMinutes(ticks), checkpoints }];
    }));
    expectGolden("day-queue", result);
  });

  it("a different day gives a different, fixed order", () => {
    expectGolden("day-queue-other-days", ["2026-11-17", "2027-01-01", "2026-03-29"].map((day) => buildDailyQueue(day, DEFAULT_DAILY_TICKS)));
  });
});

/* ---------- the day's cards, step by step ---------- */

type Step =
  | { rep: number }
  | { copyMs: number }
  | { decline: true }
  | { doneCardShown: true };

function runDay(drillReps: number, copyBudgetMin: number, steps: readonly Step[]) {
  const input: DayInput = { drillReps, drillRepsLeft: drillReps, copyMs: 0, copyBudgetMin, marks: emptyMarks(DAY) };
  const snapshot = (after: string) => {
    const clock = copyClockState(input);
    return {
      after,
      repsLeft: input.drillRepsLeft,
      copyMs: input.copyMs,
      todayCard: todayCard(input),
      copyClock: clock,
      copyText: copyTimeText(clock),
      copyCard: copyCardAtCheckpoint(input),
      dayFinished: dayFinished(input),
    };
  };
  const log = [snapshot("start")];
  for (const step of steps) {
    if ("rep" in step) input.drillRepsLeft = Math.max(0, input.drillRepsLeft - step.rep);
    if ("copyMs" in step) input.copyMs = step.copyMs;
    if ("decline" in step) input.marks = { ...input.marks, handoffDeclined: true };
    if ("doneCardShown" in step) input.marks = { ...input.marks, doneCardShown: true };
    log.push(snapshot(JSON.stringify(step)));
  }
  return log;
}

const MIN = 60_000;

describe("golden: the daily flow's cards", () => {
  it("each kind of day, step by step", () => {
    expectGolden("day-cards", {
      drillsThenCopy: runDay(98, 30, [
        { rep: 1 }, { rep: 48 }, { rep: 48 }, { rep: 1 },
        { copyMs: 1 }, { copyMs: 10 * MIN }, { copyMs: 30 * MIN - 1 }, { copyMs: 30 * MIN }, { doneCardShown: true }, { copyMs: 41 * MIN },
      ]),
      handoffDeclined: runDay(10, 30, [{ rep: 10 }, { decline: true }, { copyMs: 5 * MIN }]),
      copyOff: runDay(10, 0, [{ rep: 5 }, { rep: 5 }, { copyMs: 7 * MIN }]),
      copyFirst: runDay(10, 15, [{ copyMs: 15 * MIN }, { doneCardShown: true }, { rep: 10 }]),
      nothingTicked: runDay(0, 30, [{ copyMs: 29 * MIN }, { copyMs: 30 * MIN }, { doneCardShown: true }]),
      nothingAtAll: runDay(0, 0, [{ copyMs: 3 * MIN }]),
      everyBudget: [0, 15, 30, 45, 60].map((budget) => runDay(4, budget, [{ rep: 4 }, { copyMs: 20 * MIN }])),
    });
  });

  it("the startup mode for every stored mode", () => {
    const modes: PracticeMode[] = [...ALL_EXERCISE_TYPES, "MIXED_BLOCKED", "MIXED_RANDOM", "TODAY"];
    expectGolden("day-startup", modes.flatMap((stored) => [DAY, "2026-11-15", null].flatMap((storedDay) => [true, false].map((repsLeft) => ({
      stored, storedDay, repsLeft, opens: startupMode(stored, storedDay, DAY, repsLeft),
    })))));
  });

  it("the seven-day row", () => {
    expectGolden("day-week", {
      none: lastSevenDays([], DAY),
      some: lastSevenDays(["2026-11-09", "2026-11-10", "2026-11-12", "2026-11-16", "2026-10-01"], DAY),
      acrossMonthAndYear: lastSevenDays(["2026-12-29", "2027-01-02"], "2027-01-03"),
    });
  });
});
