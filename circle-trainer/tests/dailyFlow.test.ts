import { describe, expect, it } from "vitest";
import {
  copyCardAtCheckpoint,
  copyClockState,
  copyLeftMs,
  copyTimeText,
  DEFAULT_COPY_BUDGET_MIN,
  drillMs,
  drillsDone,
  emptyMarks,
  formatCountdown,
  marksForToday,
  parseCopyBudget,
  parseMarks,
  todayCard,
  type DayInput,
} from "../src/core/dailyFlow";
import { buildDailyQueue, queueRemaining } from "../src/core/dailyQueue";
import { dayKey, PracticeClock } from "../src/core/timer";

/** Local time, so the tests hold in any time zone. */
const at = (day: number, hour: number, minute = 0, second = 0) => new Date(2026, 10, day, hour, minute, second).getTime();
const MIN = 60_000;
const DAY = "2026-11-14";

function input(overrides: Partial<DayInput> = {}): DayInput {
  return { drillReps: 50, drillRepsLeft: 0, copyMs: 0, copyBudgetMin: 30, marks: emptyMarks(DAY), ...overrides };
}

/** Draws in Copy from `from` to `to`, one stroke every 20 s, as the Copy view reports it. */
function copyFor(clock: PracticeClock, from: number, to: number): void {
  for (let now = from; now <= to; now += 20_000) clock.recordActivity(now);
}

describe("daily flow", () => {
  it("defaults to 30 minutes and accepts only the offered budgets", () => {
    expect(DEFAULT_COPY_BUDGET_MIN).toBe(30);
    for (const value of [0, 15, 30, 45, 60]) expect(parseCopyBudget(value)).toBe(value);
    for (const value of [20, -15, "30", null, undefined]) expect(parseCopyBudget(value)).toBeNull();
  });

  it("shows no card while drill reps remain", () => {
    expect(todayCard(input({ drillRepsLeft: 3 }))).toBeNull();
  });

  it("hands off to Copy when the drills are done and Copy time is left", () => {
    expect(todayCard(input({ copyMs: 0 }))).toBe("HANDOFF");
    expect(todayCard(input({ copyMs: 12 * MIN }))).toBe("HANDOFF");
    expect(copyLeftMs(input({ copyMs: 12 * MIN }))).toBe(18 * MIN);
  });

  it("finishes the day after the handoff is declined", () => {
    expect(todayCard(input({ marks: { ...emptyMarks(DAY), handoffDeclined: true } }))).toBe("DONE");
  });

  it("shows Done after the drills when Copy was finished first", () => {
    const copyFirst = input({ drillRepsLeft: 40, copyMs: 31 * MIN });
    expect(todayCard(copyFirst)).toBeNull();
    // Time ran out with drills left: the card offers Today instead of saying the day is done.
    expect(copyCardAtCheckpoint(copyFirst)).toBe("DRILLS_LEFT");
    const marks = { ...emptyMarks(DAY), doneCardShown: true };
    expect(todayCard({ ...copyFirst, drillRepsLeft: 0, marks })).toBe("DONE");
  });

  it("skips the handoff and the Copy card when the budget is Off", () => {
    const off = input({ copyBudgetMin: 0, copyMs: 10 * MIN });
    expect(todayCard(off)).toBe("DONE");
    expect(copyClockState(off)).toEqual({ kind: "OFF" });
    expect(copyTimeText(copyClockState(off))).toBeNull();
    expect(copyCardAtCheckpoint(off)).toBeNull();
  });

  it("keeps the empty-queue card when nothing is ticked, and counts no drills as done", () => {
    const empty = input({ drillReps: 0, drillRepsLeft: 0 });
    expect(todayCard(empty)).toBe("NOTHING_TICKED");
    expect(drillsDone(empty)).toBe(true);
    expect(copyCardAtCheckpoint({ ...empty, copyMs: 30 * MIN })).toBe("DAY_DONE");
  });

  it("counts down, then says time is up, then shows time done once the card has been seen", () => {
    expect(copyTimeText(copyClockState(input({ copyMs: 17 * MIN + 20_000 })))).toBe("12:40 left");
    // Rounded up, so it never shows 0:00 with time still left.
    expect(formatCountdown(400)).toBe("0:01");
    const up = input({ copyMs: 30 * MIN });
    expect(copyClockState(up)).toEqual({ kind: "TIME_UP" });
    expect(copyTimeText(copyClockState(up))).toBe("Time's up · finish this one");
    const seen = { ...up, copyMs: 34 * MIN, marks: { ...emptyMarks(DAY), doneCardShown: true } };
    expect(copyTimeText(copyClockState(seen))).toBe("34 min copied");
  });

  it("shows the Done card only once a day", () => {
    const up = input({ copyMs: 30 * MIN });
    expect(copyCardAtCheckpoint(input({ copyMs: 29 * MIN }))).toBeNull();
    expect(copyCardAtCheckpoint(up)).toBe("DAY_DONE");
    const marks = { ...up.marks, doneCardShown: true };
    expect(copyCardAtCheckpoint({ ...up, marks })).toBeNull();
    expect(copyCardAtCheckpoint({ ...up, copyMs: 50 * MIN, marks })).toBeNull();
  });

  it("counts any Copy time today, through the card or the menu, before or after drills", () => {
    const copyClock = new PracticeClock();
    copyFor(copyClock, at(14, 8, 0), at(14, 8, 10)); // before the drills, from the mode menu
    copyFor(copyClock, at(14, 19, 0), at(14, 19, 15)); // after them, from the card
    const copyMs = copyClock.todayTotalMs(at(14, 20, 0));
    expect(Math.round(copyMs / MIN)).toBe(27);
    expect(todayCard(input({ copyMs }))).toBe("HANDOFF");
    expect(Math.round(copyLeftMs(input({ copyMs })) / MIN)).toBe(3);
  });

  it("works out drill time from the two clocks", () => {
    expect(drillMs(41 * MIN, 30 * MIN)).toBe(11 * MIN);
    expect(drillMs(5 * MIN, 6 * MIN)).toBe(0);
  });

  it("starts fresh at the 4 am rollover while the page is open", () => {
    const yesterday = dayKey(at(14, 3, 0));
    expect(yesterday).toBe("2026-11-13");
    const marks = { dayKey: yesterday, handoffDeclined: true, doneCardShown: true };
    const copyClock = new PracticeClock();
    copyFor(copyClock, at(14, 3, 20), at(14, 4, 10)); // drawing straight through 4 am

    const before = at(14, 3, 59, 59);
    const yesterdayInput = input({ copyMs: copyClock.todayTotalMs(before), marks: marksForToday(marks, before) });
    expect(copyClockState(yesterdayInput).kind).toBe("DONE");

    const after = at(14, 4, 10);
    const todayMarks = marksForToday(marks, after);
    expect(todayMarks).toEqual(emptyMarks("2026-11-14"));
    const queue = buildDailyQueue(dayKey(after), ["LINE"]);
    const today = input({ drillReps: queue.order.length, drillRepsLeft: queueRemaining(queue), copyMs: copyClock.todayTotalMs(after), marks: todayMarks });
    expect(today.copyMs).toBe(10 * MIN);
    expect(copyClockState(today)).toEqual({ kind: "COUNTDOWN", leftMs: 20 * MIN });
    expect(todayCard(today)).toBeNull();
  });

  it("keeps today's marks and reads stored ones defensively", () => {
    const marks = { dayKey: DAY, handoffDeclined: false, doneCardShown: true };
    expect(marksForToday(marks, at(14, 12))).toBe(marks);
    expect(parseMarks(marks)).toEqual(marks);
    expect(parseMarks({ dayKey: DAY, doneCardShown: "yes" })).toEqual(emptyMarks(DAY));
    expect(parseMarks(null)).toBeNull();
    expect(parseMarks({ handoffDeclined: true })).toBeNull();
  });
});
