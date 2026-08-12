import { describe, expect, it } from "vitest";
import { analyseTargetStroke } from "../src/core/primitiveMetrics";
import { sampleTargetPathCss } from "../src/core/targets";
import type { CircleTarget, EllipseTarget, Point2, RawStroke, TargetDefinition } from "../src/core/types";

function strokeFromPoints(points: readonly Point2[], durationMs = 900): RawStroke {
  return {
    id: "synthetic",
    pointerType: "pen",
    startedAtEpochMs: 0,
    cancelled: false,
    samples: points.map((point, index) => ({
      xCss: point.x,
      yCss: point.y,
      tMs: durationMs * index / Math.max(1, points.length - 1),
      sourceEventType: index === 0 ? "pointerdown" : index === points.length - 1 ? "pointerup" : "pointermove",
    })),
  };
}

function perfectStroke(target: TargetDefinition, reverse = false): RawStroke {
  const points = sampleTargetPathCss(target, 1, 260);
  return strokeFromPoints(reverse ? points.reverse() : points);
}

const circle: CircleTarget = { kind: "CIRCLE", centerCss: { x: 150, y: 150 }, radiusMm: 70, landmarkPhaseRad: 0.3 };
const ellipse: EllipseTarget = { kind: "ELLIPSE", centerCss: { x: 160, y: 145 }, aMm: 90, bMm: 42, thetaRad: 0.65 };
const arc: TargetDefinition = { kind: "ARC", centerCss: { x: 150, y: 180 }, radiusMm: 90, startAngleRad: 3.5, sweepRad: 2.2 };
const sCurve: TargetDefinition = {
  kind: "S_CURVE", centerCss: { x: 180, y: 160 }, lengthMm: 230,
  amplitudeStartMm: 42, amplitudeEndMm: 36, thetaRad: 0.45,
};

describe("closed primitive metrics", () => {
  it("scores perfect circles and ellipses in either direction", () => {
    for (const target of [circle, ellipse]) {
      expect(analyseTargetStroke(perfectStroke(target), target, 1).accuracyScore).toBeGreaterThanOrEqual(98);
      expect(analyseTargetStroke(perfectStroke(target, true), target, 1).accuracyScore).toBeGreaterThanOrEqual(98);
    }
  });

  it("rejects partial loops", () => {
    for (const target of [circle, ellipse]) {
      const partial = sampleTargetPathCss(target, 1, 260).slice(0, 180);
      expect(analyseTargetStroke(strokeFromPoints(partial), target, 1).executionPassed).toBe(false);
    }
  });

  it("does not reward an ellipse-shaped stroke as a good circle", () => {
    const ellipseStroke: EllipseTarget = { kind: "ELLIPSE", centerCss: circle.centerCss, aMm: 82, bMm: 48, thetaRad: 0 };
    const result = analyseTargetStroke(perfectStroke(ellipseStroke), circle, 1);
    expect(result.accuracyScore ?? 0).toBeLessThan(55);
  });

  it("scores ellipses across orientation and axis ratio", () => {
    for (const [thetaRad, ratio] of [[0, 0.36], [1.1, 0.55], [2.45, 0.77]] as const) {
      const target: EllipseTarget = {
        kind: "ELLIPSE", centerCss: { x: 180, y: 170 }, aMm: 88,
        bMm: 88 * ratio, thetaRad,
      };
      expect(analyseTargetStroke(perfectStroke(target), target, 1).accuracyScore).toBeGreaterThanOrEqual(98);
    }
  });
});

describe("open primitive metrics", () => {
  it("scores perfect arcs and S curves in either direction", () => {
    for (const target of [arc, sCurve]) {
      expect(analyseTargetStroke(perfectStroke(target), target, 1).accuracyScore).toBeGreaterThanOrEqual(98);
      expect(analyseTargetStroke(perfectStroke(target, true), target, 1).accuracyScore).toBeGreaterThanOrEqual(98);
    }
  });

  it("rejects incomplete arcs and S curves", () => {
    for (const target of [arc, sCurve]) {
      const partial = sampleTargetPathCss(target, 1, 260).slice(0, 120);
      expect(analyseTargetStroke(strokeFromPoints(partial), target, 1).executionPassed).toBe(false);
    }
  });

  it("degrades smoothly when an open curve is displaced", () => {
    for (const target of [arc, sCurve]) {
      const perfect = analyseTargetStroke(perfectStroke(target), target, 1).accuracyScore ?? 0;
      const displaced = sampleTargetPathCss(target, 1, 260).map((point) => ({ x: point.x + 8, y: point.y - 5 }));
      const worse = analyseTargetStroke(strokeFromPoints(displaced), target, 1).accuracyScore ?? 0;
      expect(worse).toBeLessThan(perfect);
    }
  });

  it("handles arc sweep, orientation, reversal, and overshoot", () => {
    for (const sweepRad of [1.25, -2.2, 2.85]) {
      const target: TargetDefinition = {
        kind: "ARC", centerCss: { x: 170, y: 165 }, radiusMm: 82,
        startAngleRad: 0.8, sweepRad,
      };
      expect(analyseTargetStroke(perfectStroke(target), target, 1).accuracyScore).toBeGreaterThanOrEqual(98);
      expect(analyseTargetStroke(perfectStroke(target, true), target, 1).accuracyScore).toBeGreaterThanOrEqual(98);
    }
    const overshot = { ...arc, sweepRad: arc.kind === "ARC" ? arc.sweepRad * 1.65 : 0 };
    expect(analyseTargetStroke(perfectStroke(overshot), arc, 1).executionPassed).toBe(false);
  });

  it("scores S curves across rotation, scale, and lobe balance", () => {
    for (const [thetaRad, lengthMm, balance] of [[0, 170, 0.8], [1.35, 230, 1], [2.7, 285, 1.2]] as const) {
      const target: TargetDefinition = {
        kind: "S_CURVE", centerCss: { x: 190, y: 180 }, lengthMm,
        amplitudeStartMm: lengthMm * 0.19, amplitudeEndMm: lengthMm * 0.19 * balance, thetaRad,
      };
      expect(analyseTargetStroke(perfectStroke(target), target, 1).accuracyScore).toBeGreaterThanOrEqual(98);
    }
  });

  it("rejects an open curve without opposing lobes as an S curve", () => {
    const source = sampleTargetPathCss(sCurve, 1, 260);
    const start = source[0];
    const end = source.at(-1)!;
    const cCurve = source.map((_, index) => {
      const t = index / (source.length - 1);
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t + Math.sin(Math.PI * t) * 55,
      };
    });
    expect(analyseTargetStroke(strokeFromPoints(cCurve), sCurve, 1).executionPassed).toBe(false);
  });

  it("does not mistake small progressive S-curve wobble for correction", () => {
    const wobbly = sampleTargetPathCss(sCurve, 1, 260).map((point, index) => ({
      x: point.x + Math.sin(index * 0.72) * 0.55,
      y: point.y + Math.cos(index * 0.67) * 0.55,
    }));
    const result = analyseTargetStroke(strokeFromPoints(wobbly), sCurve, 1);
    expect(result.metrics).toHaveProperty("curvatureSignTransitions");
    expect("curvatureSignTransitions" in result.metrics ? result.metrics.curvatureSignTransitions : 0).toBeGreaterThan(8);
    expect(result.executionPassed).toBe(true);
  });
});

describe("error monotonicity and correction gates", () => {
  const targets: TargetDefinition[] = [circle, ellipse, arc, sCurve];

  it("scores noisy versions below their perfect references", () => {
    for (const target of targets) {
      const source = sampleTargetPathCss(target, 1, 260);
      const noisy = source.map((point, index) => ({
        x: point.x + Math.sin(index * 1.71) * 3,
        y: point.y + Math.cos(index * 1.37) * 3,
      }));
      const perfectScore = analyseTargetStroke(strokeFromPoints(source), target, 1).accuracyScore ?? 0;
      const noisyScore = analyseTargetStroke(strokeFromPoints(noisy), target, 1).accuracyScore ?? 0;
      expect(noisyScore).toBeLessThan(perfectScore);
    }
  });

  it("rejects obvious backtracking before scoring", () => {
    for (const target of targets) {
      const source = sampleTargetPathCss(target, 1, 260);
      const corrective = [...source.slice(0, 130), ...source.slice(65, 130).reverse(), ...source.slice(65)];
      const result = analyseTargetStroke(strokeFromPoints(corrective, 1600), target, 1);
      expect(result.executionPassed, `${target.kind}: ${JSON.stringify(result.metrics)}`).toBe(false);
      expect(result.accuracyScore).toBeUndefined();
    }
  });

  it("can score corrective strokes when correction rejection is off", () => {
    for (const target of targets) {
      const source = sampleTargetPathCss(target, 1, 260);
      const corrective = [...source.slice(0, 130), ...source.slice(65, 130).reverse(), ...source.slice(65)];
      const result = analyseTargetStroke(strokeFromPoints(corrective, 1600), target, 1, false);
      expect(result.executionPassed, `${target.kind}: ${result.executionReason}`).toBe(true);
      expect(result.accuracyScore).toBeTypeOf("number");
    }
  });
});
