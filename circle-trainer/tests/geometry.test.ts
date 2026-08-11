import { describe, expect, it } from "vitest";
import { cssPxToMm, pointCssPxToMm, resampleByArcLength } from "../src/core/geometry";

describe("physical coordinate conversion", () => {
  it("converts CSS pixels to calibrated millimetres", () => {
    expect(cssPxToMm(250, 2.5)).toBe(100);
    expect(pointCssPxToMm({ x: 25, y: 50 }, 2.5)).toEqual({ x: 10, y: 20 });
  });

  it("rejects an invalid calibration", () => {
    expect(() => cssPxToMm(100, 0)).toThrow(RangeError);
  });
});

describe("arc-length resampling", () => {
  it("spaces points uniformly along a polyline", () => {
    expect(resampleByArcLength([{ x: 0, y: 0 }, { x: 10, y: 0 }], 3)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it("uses distance rather than source sample density", () => {
    const result = resampleByArcLength(
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 0 }],
      6,
    );
    expect(result.map((point) => point.x)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("handles a stationary path", () => {
    expect(resampleByArcLength([{ x: 3, y: 4 }, { x: 3, y: 4 }], 3)).toEqual([
      { x: 3, y: 4 },
      { x: 3, y: 4 },
      { x: 3, y: 4 },
    ]);
  });
});
