import { describe, expect, it } from "vitest";
import { buildDailyQueue, isQueueDone, queueRemaining, repCountsForTicks, retickQueue } from "../src/core/dailyQueue";
import { dayKey } from "../src/core/timer";
import type { ExerciseType } from "../src/core/types";

const NOW = new Date(2026, 10, 17, 12).getTime();
const TODAY = dayKey(NOW);
const counts = (ticks: ExerciseType[]) => repCountsForTicks(ticks);
const tally = (order: readonly ExerciseType[]) => order.reduce<Record<string, number>>((all, type) => ({ ...all, [type]: (all[type] ?? 0) + 1 }), {});

describe("changing the ticks during the day (0.18.1)", () => {
  const started = { ...buildDailyQueue(TODAY, ["LINE", "CIRCLE", "ELLIPSE", "BOX"]), position: 10 };
  const done = started.order.slice(0, 10);

  it("keeps the reps already done and rebuilds the rest from the new ticks", () => {
    const { queue, outcome } = retickQueue(started, counts(["LINE"]), NOW);
    expect(outcome).toBe("UPDATED");
    expect(queue.position).toBe(10);
    expect(queue.order.slice(0, 10)).toEqual(done);
    const linesDone = done.filter((type) => type === "LINE").length;
    // Lines left: 40 less the lines already done; nothing else is added.
    expect(tally(queue.order.slice(10))).toEqual({ LINE: 40 - linesDone });
  });

  it("adds a newly ticked drill to what is left", () => {
    const { queue } = retickQueue(started, counts(["LINE", "CIRCLE", "ELLIPSE", "BOX", "ARC"]), NOW);
    expect(queue.order.slice(0, 10)).toEqual(done);
    expect(tally(queue.order).ARC).toBe(30);
    expect(queueRemaining(queue)).toBe(98 + 30 - 10);
  });

  it("keeps the rep in progress, so the change applies from the next one", () => {
    const { queue } = retickQueue(started, counts(["LINE"]), NOW, true);
    expect(queue.order.slice(0, 11)).toEqual(started.order.slice(0, 11));
    expect(queue.position).toBe(10);
  });

  it("can finish the day at once when what is left is already done", () => {
    const linesOnly = { ...buildDailyQueue(TODAY, ["LINE", "BOX"]), position: 0 };
    const order = [...linesOnly.order.filter((type) => type === "LINE"), ...linesOnly.order.filter((type) => type !== "LINE")];
    const afterLines = { dayKey: TODAY, order, position: 40 };
    const { queue, outcome } = retickQueue(afterLines, counts(["LINE"]), NOW);
    expect(outcome).toBe("UPDATED");
    expect(isQueueDone(queue)).toBe(true);
  });

  it("waits for tomorrow once the day is finished", () => {
    const finished = { ...started, position: started.order.length };
    expect(retickQueue(finished, counts(["ARC"]), NOW, false, true)).toEqual({ queue: finished, outcome: "FINISHED" });
  });

  it("adds drills back after everything was unticked (an empty rest is not a finished day)", () => {
    const { queue: emptied } = retickQueue(started, counts([]), NOW);
    expect(isQueueDone(emptied)).toBe(true);
    expect(emptied.order).toEqual(done);
    const { queue, outcome } = retickQueue(emptied, counts(["CIRCLE"]), NOW);
    expect(outcome).toBe("UPDATED");
    expect(queue.order.slice(0, 10)).toEqual(done);
    expect(queueRemaining(queue)).toBe(24 - done.filter((type) => type === "CIRCLE").length);
  });

  it("reopens a queue that is done when the day is not finished (Copy time left)", () => {
    const allDone = { ...started, position: started.order.length };
    const { queue, outcome } = retickQueue(allDone, counts(["LINE", "CIRCLE", "ELLIPSE", "BOX", "ARC"]), NOW, false, false);
    expect(outcome).toBe("UPDATED");
    expect(queueRemaining(queue)).toBe(30);
  });

  it("builds afresh before the first rep, on a new day, or from nothing", () => {
    const fresh = buildDailyQueue(TODAY, ["ARC"]);
    expect(retickQueue({ ...started, position: 0 }, counts(["ARC"]), NOW)).toEqual({ queue: fresh, outcome: "REBUILT" });
    expect(retickQueue({ ...started, dayKey: "2026-11-16" }, counts(["ARC"]), NOW)).toEqual({ queue: fresh, outcome: "REBUILT" });
    expect(retickQueue(null, counts(["ARC"]), NOW)).toEqual({ queue: fresh, outcome: "REBUILT" });
  });

  it("is the same every time for the same day and change", () => {
    expect(retickQueue(started, counts(["LINE", "BOX"]), NOW)).toEqual(retickQueue(started, counts(["LINE", "BOX"]), NOW));
  });
});
