import { describe, expect, it } from "vitest";
import { EXERCISE_TYPES } from "../src/core/scheduler";
import { generateTarget, sampleTargetPathCss, targetCheckpointsCss } from "../src/core/targets";

describe("target generation", () => {
  it("keeps every generated primitive inside the drawing surface", () => {
    const viewport = { width: 810, height: 804 };
    for (const type of EXERCISE_TYPES) {
      for (let index = 0; index < 80; index += 1) {
        const target = generateTarget(type, viewport, 5.23, "viewport-seed", index);
        for (const point of sampleTargetPathCss(target, 5.23, 256)) {
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.x).toBeLessThanOrEqual(viewport.width);
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeLessThanOrEqual(viewport.height);
        }
      }
    }
  });

  it("uses the planned checkpoint counts", () => {
    const viewport = { width: 810, height: 804 };
    const expected = { LINE: 2, ARC: 3, CIRCLE: 4, ELLIPSE: 4, S_CURVE: 4 } as const;
    for (const type of EXERCISE_TYPES) {
      const target = generateTarget(type, viewport, 5.23, "checkpoint-seed", 1);
      expect(targetCheckpointsCss(target, 5.23)).toHaveLength(expected[type]);
    }
  });
});
