import { describe, expect, it } from "vitest";
import {
  answerCornersMmForSwing,
  BOX_EDGES,
  boxAreas,
  boxTargetRejection,
  generateBoxTarget,
  length3,
  nonHingeEdgeIndices,
  oppositeEdgeIndex,
  projectBoxPair,
  referenceCorners3d,
  swungCorners3d,
  type Quaternion,
  type Vec3,
} from "../src/core/box";
import { analyseBoxStrokes, matchStrokesToEdges } from "../src/core/boxMetrics";
import { seededRandom, shuffle } from "../src/core/random";
import type { BoxTarget, BoxTrialRecord, Point2, RawStroke } from "../src/core/types";
import { normalizeStoredTrial } from "../src/storage";

const IDENTITY: Quaternion = [1, 0, 0, 0];
const PX = 5.2;
const VIEWPORTS = [{ width: 1180, height: 690 }, { width: 820, height: 1030 }];

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

function strokeAlong(a: Point2, b: Point2, id: string, startMs = 0): RawStroke {
  return {
    id,
    pointerType: "pen",
    startedAtEpochMs: startMs,
    cancelled: false,
    samples: Array.from({ length: 24 }, (_, index) => {
      const t = index / 23;
      return {
        xCss: a.x + (b.x - a.x) * t,
        yCss: a.y + (b.y - a.y) * t,
        tMs: startMs + index * 10,
        sourceEventType: index === 0 ? "pointerdown" : index === 23 ? "pointerup" : "pointermove",
      };
    }),
  };
}

/** Perfect strokes for the box swung by `swingDeg`, in edge order, alternately drawn backwards. */
function strokesForSwing(target: BoxTarget, swingDeg: number): RawStroke[] {
  const cornersCss = answerCornersMmForSwing(target, swingDeg, PX).map((point) => ({ x: point.x * PX, y: point.y * PX }));
  return nonHingeEdgeIndices(target.hingeEdgeIndex).map((edge, order) => {
    const [a, b] = BOX_EDGES[edge];
    return order % 2 === 0
      ? strokeAlong(cornersCss[a], cornersCss[b], `s${edge}`, order * 1000)
      : strokeAlong(cornersCss[b], cornersCss[a], `s${edge}`, order * 1000);
  });
}

describe("box geometry", () => {
  it("projects a known cube with the expected perspective", () => {
    const factor = 4;
    const projected = projectBoxPair({ dimensionsMm: [20, 20, 20], referenceRotation: IDENTITY, hingeEdgeIndex: 0, swingDeg: 0, cameraDistanceFactor: factor });
    const distance = Math.sqrt(1200) * factor;
    // Corner 3 is (+10, +10, -10): on the near face.
    expect(projected.referenceMm[3].x).toBeCloseTo((distance * 10) / (distance - 10), 9);
    expect(projected.referenceMm[3].y).toBeCloseTo((distance * 10) / (distance - 10), 9);
    // Corner 4 is (-10, -10, +10): on the far face.
    expect(projected.referenceMm[4].x).toBeCloseTo((distance * -10) / (distance + 10), 9);
    // Near face is larger than the far face; with no swing the answer equals the reference.
    expect(Math.abs(projected.referenceMm[0].x)).toBeGreaterThan(Math.abs(projected.referenceMm[4].x));
    expect(projected.answerMm).toEqual(projected.referenceMm);
  });

  it("keeps the hinge fixed and preserves every edge length when swinging", () => {
    const corners = referenceCorners3d([40, 25, 18], [0.8, 0.3, -0.4, 0.33].map((v, _, q) => v / Math.hypot(...q)) as Quaternion);
    for (let hinge = 0; hinge < 12; hinge += 1) {
      const swung = swungCorners3d(corners, hinge, (47 * Math.PI) / 180);
      const [a, b] = BOX_EDGES[hinge];
      for (const corner of [a, b]) for (let k = 0; k < 3; k += 1) expect(swung[corner][k]).toBeCloseTo(corners[corner][k], 9);
      for (const [p, q] of BOX_EDGES) expect(length3(sub(swung[q], swung[p]))).toBeCloseTo(length3(sub(corners[q], corners[p])), 9);
      const [c, d] = BOX_EDGES[oppositeEdgeIndex(hinge)];
      expect(new Set([a, b, c, d]).size).toBe(4);
      expect(length3(sub(swung[c], corners[c]))).toBeGreaterThan(1);
    }
  });

  it("generates deterministic targets that pass every filter", () => {
    for (const viewport of VIEWPORTS) {
      for (let index = 0; index < 60; index += 1) {
        const target = generateBoxTarget(viewport, PX, "box-seed", index);
        expect(generateBoxTarget(viewport, PX, "box-seed", index)).toEqual(target);
        expect(boxTargetRejection(target, viewport, PX)).toBeNull();
        expect([30, 45, 60]).toContain(Math.abs(target.swingDeg));
        const longest = Math.max(...target.dimensionsMm);
        expect(longest).toBeGreaterThanOrEqual(30);
        expect(longest).toBeLessThanOrEqual(55);
        for (const dimension of target.dimensionsMm) expect(dimension / longest).toBeGreaterThanOrEqual(0.4 - 1e-9);
        // The hinge is the same 2D segment, translated.
        const [a, b] = BOX_EDGES[target.hingeEdgeIndex];
        const referenceVector = { x: target.referenceCornersCss[b].x - target.referenceCornersCss[a].x, y: target.referenceCornersCss[b].y - target.referenceCornersCss[a].y };
        const answerVector = { x: target.answerCornersCss[b].x - target.answerCornersCss[a].x, y: target.answerCornersCss[b].y - target.answerCornersCss[a].y };
        expect(answerVector.x).toBeCloseTo(referenceVector.x, 6);
        expect(answerVector.y).toBeCloseTo(referenceVector.y, 6);
      }
    }
    expect(generateBoxTarget(VIEWPORTS[0], PX, "box-seed", 1)).not.toEqual(generateBoxTarget(VIEWPORTS[0], PX, "box-seed", 2));
  });
});

describe("drawing hand layout", () => {
  const centreX = (rect: { x: number; width: number }) => rect.x + rect.width / 2;

  it("puts the drawing half on the drawing hand's side in landscape", () => {
    const left = boxAreas(VIEWPORTS[0], "LEFT");
    const right = boxAreas(VIEWPORTS[0], "RIGHT");
    expect(centreX(left.answer)).toBeLessThan(centreX(left.reference));
    expect(centreX(right.answer)).toBeGreaterThan(centreX(right.reference));
    expect(left.answer).toEqual(right.reference);
    expect(left.reference).toEqual(right.answer);
    expect(boxAreas(VIEWPORTS[0])).toEqual(left);
  });

  it("keeps the reference on top in portrait for either hand", () => {
    expect(boxAreas(VIEWPORTS[1], "LEFT")).toEqual(boxAreas(VIEWPORTS[1], "RIGHT"));
    expect(boxAreas(VIEWPORTS[1]).reference.y).toBeLessThan(boxAreas(VIEWPORTS[1]).answer.y);
  });

  it("generates targets that fit the chosen hand's layout", () => {
    for (const hand of ["LEFT", "RIGHT"] as const) {
      for (let index = 0; index < 20; index += 1) {
        const target = generateBoxTarget(VIEWPORTS[0], PX, "hand-seed", index, hand);
        expect(boxTargetRejection(target, VIEWPORTS[0], PX, hand)).toBeNull();
        const answerIsLeft = target.answerOffsetCss.x < target.referenceOffsetCss.x;
        expect(answerIsLeft).toBe(hand === "LEFT");
        // Same shape either way: only the halves swap.
        expect(target.dimensionsMm).toEqual(generateBoxTarget(VIEWPORTS[0], PX, "hand-seed", index, hand === "LEFT" ? "RIGHT" : "LEFT").dimensionsMm);
      }
    }
  });
});

describe("box scoring", () => {
  const target = generateBoxTarget(VIEWPORTS[0], PX, "score-seed", 3);

  it("finds the minimum-cost one-to-one assignment", () => {
    // Greedy (stroke 0 takes its cheapest edge first) would total 9; the optimum is 3 + 1 + 1 = 5.
    const costs = [[1, 2, 3], [1, 5, 9], [4, 1, 3]];
    expect(matchStrokesToEdges(costs)).toEqual([2, 0, 1]);
  });

  it("scores perfect strokes at 100 with the fitted swing equal to the target", () => {
    const result = analyseBoxStrokes(strokesForSwing(target, target.swingDeg), target, PX);
    expect(result.executionPassed).toBe(true);
    expect(result.accuracyScore).toBe(100);
    expect(result.metrics.fittedSwingDeg).toBeCloseTo(target.swingDeg, 1);
    expect(result.metrics.rmsOrthogonalDeviationMm).toBeCloseTo(0, 6);
    expect(result.metrics.edges).toHaveLength(11);
    expect(result.metrics.edges.every((edge) => edge.strokeId === `s${edge.edgeIndex}`)).toBe(true);
  });

  it("does not depend on drawing order", () => {
    const strokes = strokesForSwing(target, target.swingDeg - 7 * Math.sign(target.swingDeg));
    const shuffled = shuffle(strokes, seededRandom("order"));
    const inOrder = analyseBoxStrokes(strokes, target, PX);
    const outOfOrder = analyseBoxStrokes(shuffled, target, PX);
    expect(outOfOrder.accuracyScore).toBe(inOrder.accuracyScore);
    expect(outOfOrder.metrics.normalizedError).toBeCloseTo(inOrder.metrics.normalizedError, 12);
    expect(outOfOrder.metrics.fittedSwingDeg).toBeCloseTo(inOrder.metrics.fittedSwingDeg, 6);
    const byStroke = (edges: typeof inOrder.metrics.edges) => Object.fromEntries(edges.map((edge) => [edge.strokeId, edge.edgeIndex]));
    expect(byStroke(outOfOrder.metrics.edges)).toEqual(byStroke(inOrder.metrics.edges));
  });

  it("reads a box swung 10° short as about 10° short", () => {
    for (let index = 0; index < 8; index += 1) {
      const box = generateBoxTarget(VIEWPORTS[index % 2], PX, "short-swing", index);
      const short = box.swingDeg - 10 * Math.sign(box.swingDeg);
      const result = analyseBoxStrokes(strokesForSwing(box, short), box, PX);
      expect(result.metrics.fittedSwingDeg).toBeCloseTo(short, 0);
      expect(result.accuracyScore).toBeLessThan(100);
    }
  });

  it("scores a box swung the wrong way much lower and reports the opposite sign", () => {
    const result = analyseBoxStrokes(strokesForSwing(target, -target.swingDeg), target, PX);
    expect(Math.sign(result.metrics.fittedSwingDeg)).toBe(-Math.sign(target.swingDeg));
    expect(result.accuracyScore).toBeLessThan(60);
  });
});

describe("box record storage", () => {
  it("passes Box trial records through stored-trial normalisation", () => {
    const target = generateBoxTarget(VIEWPORTS[0], PX, "storage-seed", 0);
    const strokes = strokesForSwing(target, target.swingDeg);
    const record: BoxTrialRecord = {
      id: "box-trial",
      appVersion: "0.4.0",
      metricVersion: "box-1",
      scoringVersion: "box-1",
      createdAtEpochMs: 1,
      exerciseType: "BOX",
      practiceMode: "BOX",
      correctionGateEnabled: false,
      schedule: { mode: "BOX", sessionSeed: "s", sequenceIndex: 0, cycleIndex: 0 },
      target,
      rawStrokes: strokes,
      calibrationId: null,
      derived: analyseBoxStrokes(strokes, target, PX),
    };
    const normalized = normalizeStoredTrial(record, 0);
    expect(normalized).toEqual(record);
    expect(normalized.exerciseType === "BOX" && normalized.rawStrokes).toHaveLength(11);
  });
});
