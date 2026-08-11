import { describe, expect, it } from "vitest";
import { analyseLineStroke } from "../src/core/lineMetrics";
import type { LineTarget, RawStroke } from "../src/core/types";

const target: LineTarget = {
  kind: "LINE",
  aCss: { x: 0, y: 0 },
  bCss: { x: 100, y: 0 },
  lengthMm: 100,
};

function stroke(points: Array<{ x: number; y: number }>, durationMs = 400): RawStroke {
  return {
    id: "test",
    pointerType: "pen",
    startedAtEpochMs: 0,
    cancelled: false,
    samples: points.map((point, index) => ({
      xCss: point.x,
      yCss: point.y,
      tMs: (durationMs * index) / Math.max(1, points.length - 1),
      sourceEventType: index === 0 ? "pointerdown" : index === points.length - 1 ? "pointerup" : "pointermove",
    })),
  };
}

function linePoints(offsetY = 0): Array<{ x: number; y: number }> {
  return Array.from({ length: 21 }, (_, index) => ({ x: index * 5, y: offsetY }));
}

describe("line analysis", () => {
  it("scores a committed perfect line at the maximum", () => {
    const result = analyseLineStroke(stroke(linePoints()), target, 1);
    expect(result.executionPassed).toBe(true);
    expect(result.accuracyScore).toBe(100);
    expect(result.metrics.rmsOrthogonalDeviationMm).toBeCloseTo(0);
  });

  it("supports drawing in either direction", () => {
    const result = analyseLineStroke(stroke(linePoints().reverse()), target, 1);
    expect(result.executionPassed).toBe(true);
    expect(result.accuracyScore).toBe(100);
  });

  it("gives a visibly displaced line a lower score", () => {
    const result = analyseLineStroke(stroke(linePoints(5)), target, 1);
    expect(result.executionPassed).toBe(true);
    expect(result.accuracyScore).toBeLessThan(70);
  });

  it("rejects a very slow constructed stroke before accuracy scoring", () => {
    const result = analyseLineStroke(stroke(linePoints(), 5000), target, 1);
    expect(result.executionPassed).toBe(false);
    expect(result.accuracyScore).toBeUndefined();
    expect(result.executionReason).toContain("Too slow");
  });
});
