import { describe, expect, it } from "vitest";
import { MIXED_EXERCISE_TYPES, PracticeScheduler } from "../src/core/scheduler";

describe("mixed practice scheduling", () => {
  it("creates balanced randomized blocks of ten", () => {
    const scheduler = new PracticeScheduler("MIXED_BLOCKED", "blocked-seed");
    const sequence = Array.from({ length: 80 }, () => {
      const current = scheduler.currentExercise();
      scheduler.advance();
      return current;
    });
    for (let offset = 0; offset < sequence.length; offset += 40) {
      const cycle = sequence.slice(offset, offset + 40);
      const blocks = Array.from({ length: 4 }, (_, index) => cycle.slice(index * 10, index * 10 + 10));
      expect(blocks.every((block) => new Set(block).size === 1)).toBe(true);
      expect(new Set(blocks.map((block) => block[0]))).toEqual(new Set(MIXED_EXERCISE_TYPES));
    }
    expect(sequence[39]).not.toBe(sequence[40]);
    expect(sequence).not.toContain("S_CURVE");
  });

  it("creates balanced random bags with no adjacent repeats", () => {
    const scheduler = new PracticeScheduler("MIXED_RANDOM", "random-seed");
    const sequence = Array.from({ length: 40 }, () => {
      const current = scheduler.currentExercise();
      scheduler.advance();
      return current;
    });
    for (let offset = 0; offset < sequence.length; offset += 4) {
      expect(new Set(sequence.slice(offset, offset + 4))).toEqual(new Set(MIXED_EXERCISE_TYPES));
    }
    for (let index = 1; index < sequence.length; index += 1) expect(sequence[index]).not.toBe(sequence[index - 1]);
    expect(sequence).not.toContain("S_CURVE");
  });

  it("is deterministic for a given seed", () => {
    const collect = () => {
      const scheduler = new PracticeScheduler("MIXED_RANDOM", "same-seed");
      return Array.from({ length: 25 }, () => {
        const current = scheduler.currentExercise();
        scheduler.advance();
        return current;
      });
    };
    expect(collect()).toEqual(collect());
  });

  it("advances only for completed attempts and resets with a mode change", () => {
    const scheduler = new PracticeScheduler("MIXED_BLOCKED", "attempt-seed");
    const first = scheduler.currentExercise();
    const beforeSkip = scheduler.context();

    // A skip or cancelled pointer does not call advance.
    expect(scheduler.currentExercise()).toBe(first);
    expect(scheduler.context()).toEqual(beforeSkip);

    // A completed attempt advances whether or not its execution gate passed.
    scheduler.advance();
    expect(scheduler.context().sequenceIndex).toBe(1);
    expect(scheduler.blockProgress()).toEqual({ current: 2, total: 10 });

    const reset = new PracticeScheduler("CIRCLE", "new-session");
    expect(reset.currentExercise()).toBe("CIRCLE");
    expect(reset.context().sequenceIndex).toBe(0);
  });
});
