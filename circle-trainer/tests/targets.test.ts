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

  it("uses practical physical sizes for common drawing movements", () => {
    const viewport = { width: 810, height: 804 };
    const sizes = {
      CIRCLE: [] as number[],
      ELLIPSE: [] as number[],
      S_CURVE: [] as number[],
    };
    for (const type of ["CIRCLE", "ELLIPSE", "S_CURVE"] as const) {
      for (let index = 0; index < 400; index += 1) {
        const target = generateTarget(type, viewport, 5.23, "size-range-seed", index);
        if (target.kind === "CIRCLE") sizes.CIRCLE.push(target.radiusMm * 2);
        if (target.kind === "ELLIPSE") sizes.ELLIPSE.push(target.aMm * 2);
        if (target.kind === "S_CURVE") sizes.S_CURVE.push(target.lengthMm);
      }
    }
    expect(Math.min(...sizes.CIRCLE)).toBeGreaterThanOrEqual(18);
    expect(Math.max(...sizes.CIRCLE)).toBeLessThanOrEqual(58);
    expect(sizes.CIRCLE.sort((a, b) => a - b)[200]).toBeGreaterThan(28);
    expect(sizes.CIRCLE[200]).toBeLessThan(42);
    expect(Math.min(...sizes.ELLIPSE)).toBeGreaterThanOrEqual(24);
    expect(Math.max(...sizes.ELLIPSE)).toBeLessThanOrEqual(64);
    expect(sizes.ELLIPSE.sort((a, b) => a - b)[200]).toBeGreaterThan(36);
    expect(sizes.ELLIPSE[200]).toBeLessThan(50);
    expect(Math.min(...sizes.S_CURVE)).toBeGreaterThanOrEqual(30);
    expect(Math.max(...sizes.S_CURVE)).toBeLessThanOrEqual(70);
    expect(sizes.S_CURVE.sort((a, b) => a - b)[200]).toBeGreaterThan(42);
    expect(sizes.S_CURVE[200]).toBeLessThan(55);
  });
});
