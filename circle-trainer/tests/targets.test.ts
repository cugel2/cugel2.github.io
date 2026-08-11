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

  it("includes medium-small and large circle and ellipse targets", () => {
    const viewport = { width: 810, height: 804 };
    const shortSide = Math.min(viewport.width, viewport.height);
    for (const type of ["CIRCLE", "ELLIPSE"] as const) {
      const diameterFractions = Array.from({ length: 160 }, (_, index) => {
        const target = generateTarget(type, viewport, 5.23, "size-range-seed", index);
        const diameterCss = target.kind === "CIRCLE"
          ? target.radiusMm * 5.23 * 2
          : target.kind === "ELLIPSE" ? target.aMm * 5.23 * 2 : 0;
        return diameterCss / shortSide;
      });
      expect(Math.min(...diameterFractions)).toBeLessThan(0.48);
      expect(Math.max(...diameterFractions)).toBeGreaterThan(0.62);
      expect(Math.min(...diameterFractions)).toBeGreaterThan(0.3);
    }
  });
});
