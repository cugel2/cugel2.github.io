import { describe, expect, it } from "vitest";
import {
  advanceQueue,
  buildDailyQueue,
  currentQueueExercise,
  DAILY_COUNTS,
  dailyMinutes,
  DEFAULT_DAILY_TICKS,
  ensureTodayQueue,
  isQueueDone,
  normalizeTicks,
  parseQueueState,
  queueMinutesLeft,
  queueRemaining,
  interleave,
  requeueForTicks,
  type DailyQueueState,
} from "../src/core/dailyQueue";
import { ALL_EXERCISE_TYPES } from "../src/core/scheduler";
import { seededRandom } from "../src/core/random";
import type { ExerciseType } from "../src/core/types";

/** Local time, so the tests hold in any time zone. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

function drain(state: DailyQueueState, count: number): DailyQueueState {
  let next = state;
  for (let index = 0; index < count; index += 1) next = advanceQueue(next);
  return next;
}

describe("daily queue", () => {
  it("builds fixed counts for each ticked mode, shuffled the same way all day", () => {
    const queue = buildDailyQueue("2026-11-13", ["BOX", "LINE"]);
    expect(queue.order.filter((type) => type === "LINE")).toHaveLength(DAILY_COUNTS.LINE);
    expect(queue.order.filter((type) => type === "BOX")).toHaveLength(DAILY_COUNTS.BOX);
    expect(queue.order).toHaveLength(50);
    expect(buildDailyQueue("2026-11-13", ["LINE", "BOX"])).toEqual(queue);
    // Shuffled: the boxes are not all bunched at one end.
    const firstBox = queue.order.indexOf("BOX");
    expect(firstBox).toBeLessThan(40);
    expect(queue.order.slice(0, 25)).toContain("LINE");
    expect(buildDailyQueue("2026-11-14", ["LINE", "BOX"]).order).not.toEqual(queue.order);
  });

  it("estimates the time left and finishes after every rep", () => {
    let queue = buildDailyQueue("2026-11-13", DEFAULT_DAILY_TICKS);
    expect(dailyMinutes(DEFAULT_DAILY_TICKS)).toBe(11);
    expect(queueMinutesLeft(queue)).toBe(Math.ceil((40 * 3 + 24 * 5 + 24 * 5 + 10 * 30) / 60));
    queue = drain(queue, queueRemaining(queue) - 1);
    expect(queueRemaining(queue)).toBe(1);
    expect(isQueueDone(queue)).toBe(false);
    queue = advanceQueue(queue);
    expect(isQueueDone(queue)).toBe(true);
    expect(currentQueueExercise(queue)).toBeNull();
    expect(queueMinutesLeft(queue)).toBe(0);
    expect(advanceQueue(queue).position).toBe(queue.position);
  });

  it("resumes the saved queue on the same day, ignoring tick changes until tomorrow", () => {
    const morning = drain(ensureTodayQueue(null, ["LINE", "CIRCLE"], at(13, 9)), 7);
    const evening = ensureTodayQueue(morning, ["BOX"], at(13, 21));
    expect(evening).toBe(morning);
    expect(currentQueueExercise(evening)).toBe(morning.order[7]);
    const tomorrow = ensureTodayQueue(evening, ["BOX"], at(14, 9));
    expect(tomorrow.dayKey).toBe("2026-11-14");
    expect(tomorrow.position).toBe(0);
    expect(new Set(tomorrow.order)).toEqual(new Set<ExerciseType>(["BOX"]));
  });

  it("rolls over at 4 am while the page stays open, with no backlog", () => {
    const late = drain(ensureTodayQueue(null, ["LINE"], at(13, 23)), 5);
    const stillToday = ensureTodayQueue(late, ["LINE"], at(14, 3, 59));
    expect(stillToday).toBe(late);
    const next = ensureTodayQueue(stillToday, ["LINE"], at(14, 4, 0));
    expect(next.dayKey).toBe("2026-11-14");
    expect(queueRemaining(next)).toBe(DAILY_COUNTS.LINE);
  });

  it("builds today's queue at once when it was built with nothing ticked", () => {
    const empty = ensureTodayQueue(null, [], at(13, 9));
    expect(empty.order).toHaveLength(0);
    expect(isQueueDone(empty)).toBe(false);
    const ticked = ensureTodayQueue(empty, ["ARC"], at(13, 10));
    expect(ticked.order).toHaveLength(DAILY_COUNTS.ARC);
  });

  it("keeps a finished day finished, and reads stored state defensively", () => {
    const done = drain(ensureTodayQueue(null, ["BOX"], at(13, 9)), 10);
    expect(isQueueDone(ensureTodayQueue(done, ["BOX", "LINE"], at(13, 22)))).toBe(true);
    expect(parseQueueState(done)).toEqual(done);
    expect(parseQueueState({ dayKey: "x", order: ["NOPE"], position: 0 })).toBeNull();
    expect(parseQueueState({ dayKey: "x", order: ["LINE"], position: 9 })?.position).toBe(1);
    expect(parseQueueState(null)).toBeNull();
    expect(normalizeTicks(["BOX", "LINE", "LINE", "MIXED_RANDOM"])).toEqual(["LINE", "BOX"]);
  });

  it("rebuilds today's queue from changed ticks until its first rep is done", () => {
    const morning = buildDailyQueue("2026-11-14", ["LINE", "CIRCLE"]);
    const changed = requeueForTicks(morning, ["LINE"], at(14, 9));
    expect(changed.rebuilt).toBe(true);
    expect(changed.queue.position).toBe(0);
    expect(new Set(changed.queue.order)).toEqual(new Set<ExerciseType>(["LINE"]));
    expect(changed.queue.order).toHaveLength(DAILY_COUNTS.LINE);

    const started = advanceQueue(morning);
    const kept = requeueForTicks(started, ["LINE"], at(14, 9));
    expect(kept.rebuilt).toBe(false);
    expect(kept.queue).toBe(started);

    // An empty queue, a missing one, or yesterday's is always rebuilt.
    expect(requeueForTicks(buildDailyQueue("2026-11-14", []), ["BOX"], at(14, 9)).queue.order).toHaveLength(DAILY_COUNTS.BOX);
    expect(requeueForTicks(null, ["BOX"], at(14, 9)).rebuilt).toBe(true);
    expect(requeueForTicks(drain(buildDailyQueue("2026-11-13", ["LINE"]), 5), ["BOX"], at(14, 9)).queue.dayKey).toBe("2026-11-14");
  });

  it("interleaves the day's reps: no mode twice in a row when the counts allow it", () => {
    const longestRun = (order: readonly unknown[]) => {
      let longest = 0;
      let run = 0;
      order.forEach((type, index) => { run = index > 0 && order[index - 1] === type ? run + 1 : 1; longest = Math.max(longest, run); });
      return longest;
    };
    // Longest run the counts force: 40 lines against 24 circles cannot avoid pairs.
    const tickSets: [ExerciseType[], number][] = [[[...DEFAULT_DAILY_TICKS], 1], [["CIRCLE", "ELLIPSE", "BOX"], 1], [[...ALL_EXERCISE_TYPES], 1], [["LINE", "CIRCLE"], 2]];
    for (const [ticks, cap] of tickSets) {
      for (let day = 1; day <= 28; day += 1) {
        const queue = buildDailyQueue(`2026-02-${String(day).padStart(2, "0")}`, ticks);
        expect(longestRun(queue.order)).toBe(cap);
        for (const type of ticks) expect(queue.order.filter((each) => each === type)).toHaveLength(DAILY_COUNTS[type]);
      }
    }
    // 40 lines against 34 others need only 5 pairs (40 - 34 - 1), and they are not bunched at the end.
    for (let day = 1; day <= 28; day += 1) {
      const order = buildDailyQueue(`2026-02-${String(day).padStart(2, "0")}`, ["LINE", "ELLIPSE", "BOX"]).order;
      const repeats = order.flatMap((type, index) => (index > 0 && order[index - 1] === type ? [index] : []));
      expect(longestRun(order)).toBe(2);
      expect(repeats).toHaveLength(5);
      expect(repeats[0]).toBeLessThan(order.length * 0.75);
    }
    // 40 lines and 10 boxes cannot avoid repeats: the lines come in runs of at most 4, one box between each.
    for (let day = 1; day <= 28; day += 1) {
      const order = buildDailyQueue(`2026-02-${String(day).padStart(2, "0")}`, ["LINE", "BOX"]).order;
      expect(longestRun(order)).toBeLessThanOrEqual(4);
      expect(order.filter((type, index) => index > 0 && order[index - 1] === type)).toHaveLength(29);
      expect(order.filter((type) => type === "BOX")).toHaveLength(10);
    }
    // One mode alone is all repeats, in its fixed count.
    expect(buildDailyQueue("2026-02-01", ["TAPER"]).order).toEqual(Array(DAILY_COUNTS.TAPER).fill("TAPER"));
    expect(interleave(new Map([["A", 3], ["B", 0]]), seededRandom("x"))).toEqual(["A", "A", "A"]);
  });
});
