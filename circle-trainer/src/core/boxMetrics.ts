import { answerCornersMmForSwing, BOX_EDGES, nonHingeEdgeIndices } from "./box";
import { pointCssPxToMm, polylineLength, resampleByArcLength } from "./geometry";
import type { AnalysisResult, BoxEdgeMetric, BoxMetrics, BoxTarget, Point2, RawStroke } from "./types";

export const BOX_METRIC_VERSION = "box-1";
export const BOX_SCORING_VERSION = "box-1";

/** Provisional: normalized error at which the score falls to 100·e^-1 ≈ 37. Tune on device. */
export const BOX_SCORE_SIGMA = 0.15;
const SCORE_EXPONENT = 1.35;
const ENDPOINT_WEIGHT = 0.6;
const RESAMPLE_COUNT = 64;
export const SWING_SEARCH_RANGE_DEG = 90;
const COARSE_STEP_DEG = 2;
const REFINE_ITERATIONS = 24;

export type BoxAnalysis = AnalysisResult<BoxMetrics>;

type Segment = readonly [Point2, Point2];

interface EdgeCost {
  rms: number;
  endpoint: number;
  cost: number;
}

function distance(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lineDistance(point: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return distance(point, a);
  return Math.abs(dx * (a.y - point.y) - (a.x - point.x) * dy) / length;
}

export function strokeEdgeCost(points: readonly Point2[], [a, b]: Segment): EdgeCost {
  let sum = 0;
  for (const point of points) {
    const d = lineDistance(point, a, b);
    sum += d * d;
  }
  const rms = Math.sqrt(sum / points.length);
  const first = points[0];
  const last = points.at(-1)!;
  const forward = (distance(first, a) + distance(last, b)) / 2;
  const reverse = (distance(first, b) + distance(last, a)) / 2;
  const endpoint = Math.min(forward, reverse);
  return { rms, endpoint, cost: rms + ENDPOINT_WEIGHT * endpoint };
}

/**
 * One-to-one assignment of strokes to edges with minimum total cost (bitmask DP over edges).
 * Requires strokes ≤ edges ≤ 16. Returns, for each stroke, the index into `edges`.
 */
export function matchStrokesToEdges(costs: readonly (readonly number[])[]): number[] {
  const strokeCount = costs.length;
  const edgeCount = strokeCount === 0 ? 0 : costs[0].length;
  if (strokeCount > edgeCount) throw new Error("More strokes than edges");
  const states = 1 << edgeCount;
  const best = new Float64Array(states).fill(Infinity);
  const choice = new Int8Array(states).fill(-1);
  best[0] = 0;
  for (let mask = 0; mask < states; mask += 1) {
    if (best[mask] === Infinity) continue;
    let stroke = 0;
    for (let bits = mask; bits; bits &= bits - 1) stroke += 1;
    if (stroke >= strokeCount) continue;
    for (let edge = 0; edge < edgeCount; edge += 1) {
      if (mask & (1 << edge)) continue;
      const next = mask | (1 << edge);
      const value = best[mask] + costs[stroke][edge];
      if (value < best[next]) {
        best[next] = value;
        choice[next] = edge;
      }
    }
  }
  let finalMask = -1;
  let finalValue = Infinity;
  for (let mask = 0; mask < states; mask += 1) {
    let count = 0;
    for (let bits = mask; bits; bits &= bits - 1) count += 1;
    if (count === strokeCount && best[mask] < finalValue) {
      finalValue = best[mask];
      finalMask = mask;
    }
  }
  const assignment = new Array<number>(strokeCount).fill(-1);
  let mask = finalMask;
  for (let stroke = strokeCount - 1; stroke >= 0; stroke -= 1) {
    const edge = choice[mask];
    assignment[stroke] = edge;
    mask &= ~(1 << edge);
  }
  return assignment;
}

interface PooledMatch {
  assignment: number[];
  perStroke: EdgeCost[];
  rms: number;
  endpoint: number;
  pooled: number;
}

function poolMatch(strokesMm: readonly Point2[][], segments: readonly Segment[]): PooledMatch {
  const costMatrix = strokesMm.map((points) => segments.map((segment) => strokeEdgeCost(points, segment)));
  const assignment = matchStrokesToEdges(costMatrix.map((row) => row.map((entry) => entry.cost)));
  const perStroke = assignment.map((edge, stroke) => costMatrix[stroke][edge]);
  const rms = Math.sqrt(perStroke.reduce((sum, entry) => sum + entry.rms ** 2, 0) / perStroke.length);
  const endpoint = Math.sqrt(perStroke.reduce((sum, entry) => sum + entry.endpoint ** 2, 0) / perStroke.length);
  return { assignment, perStroke, rms, endpoint, pooled: Math.hypot(rms, ENDPOINT_WEIGHT * endpoint) };
}

function segmentsForCorners(corners: readonly Point2[], edgeIndices: readonly number[]): Segment[] {
  return edgeIndices.map((index) => [corners[BOX_EDGES[index][0]], corners[BOX_EDGES[index][1]]] as const);
}

function undirectedAngleDeg(a: Point2, b: Point2): number {
  const angle = Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y)) * 180 / Math.PI;
  return Math.min(angle, 180 - angle);
}

/** Swing (deg) about the target's hinge that best explains the strokes: coarse grid, then golden-section refinement. */
export function fitSwingDeg(strokesMm: readonly Point2[][], target: BoxTarget, cssPxPerMm: number): number {
  const edgeIndices = nonHingeEdgeIndices(target.hingeEdgeIndex);
  const objective = (swingDeg: number): number => (
    poolMatch(strokesMm, segmentsForCorners(answerCornersMmForSwing(target, swingDeg, cssPxPerMm), edgeIndices)).pooled
  );
  let bestSwing = 0;
  let bestValue = Infinity;
  for (let swing = -SWING_SEARCH_RANGE_DEG; swing <= SWING_SEARCH_RANGE_DEG; swing += COARSE_STEP_DEG) {
    const value = objective(swing);
    if (value < bestValue) {
      bestValue = value;
      bestSwing = swing;
    }
  }
  const ratio = (Math.sqrt(5) - 1) / 2;
  let low = Math.max(-SWING_SEARCH_RANGE_DEG, bestSwing - COARSE_STEP_DEG);
  let high = Math.min(SWING_SEARCH_RANGE_DEG, bestSwing + COARSE_STEP_DEG);
  let x1 = high - ratio * (high - low);
  let x2 = low + ratio * (high - low);
  let f1 = objective(x1);
  let f2 = objective(x2);
  for (let iteration = 0; iteration < REFINE_ITERATIONS; iteration += 1) {
    if (f1 < f2) {
      high = x2; x2 = x1; f2 = f1;
      x1 = high - ratio * (high - low); f1 = objective(x1);
    } else {
      low = x1; x1 = x2; f1 = f2;
      x2 = low + ratio * (high - low); f2 = objective(x2);
    }
  }
  const refined = (low + high) / 2;
  return objective(refined) <= bestValue ? refined : bestSwing;
}

export function analyseBoxStrokes(strokes: readonly RawStroke[], target: BoxTarget, cssPxPerMm: number): BoxAnalysis {
  if (strokes.length === 0 || strokes.some((stroke) => stroke.samples.length === 0)) throw new Error("Cannot analyse empty box strokes");
  const rawMm = strokes.map((stroke) => stroke.samples.map((sample) => pointCssPxToMm({ x: sample.xCss, y: sample.yCss }, cssPxPerMm)));
  const strokesMm = rawMm.map((points) => resampleByArcLength(points, RESAMPLE_COUNT));
  const edgeIndices = nonHingeEdgeIndices(target.hingeEdgeIndex);
  const cornersMm = target.answerCornersCss.map((point) => pointCssPxToMm(point, cssPxPerMm));
  const segments = segmentsForCorners(cornersMm, edgeIndices);
  const match = poolMatch(strokesMm, segments);
  const scaleMm = segments.reduce((sum, [a, b]) => sum + distance(a, b), 0) / segments.length;

  const edges: BoxEdgeMetric[] = match.assignment.map((edge, stroke) => {
    const [a, b] = segments[edge];
    const points = strokesMm[stroke];
    const chord = { x: points.at(-1)!.x - points[0].x, y: points.at(-1)!.y - points[0].y };
    return {
      edgeIndex: edgeIndices[edge],
      strokeId: strokes[stroke].id,
      rmsMm: match.perStroke[stroke].rms,
      endpointMm: match.perStroke[stroke].endpoint,
      angleErrorDeg: undirectedAngleDeg(chord, { x: b.x - a.x, y: b.y - a.y }),
    };
  });

  const normalizedError = match.pooled / Math.max(scaleMm, 1);
  const starts = strokes.map((stroke) => stroke.samples[0].tMs);
  const ends = strokes.map((stroke) => stroke.samples.at(-1)!.tMs);
  const metrics: BoxMetrics = {
    edges,
    rmsOrthogonalDeviationMm: match.rms,
    endpointMeanErrorMm: match.endpoint,
    meanAngleErrorDeg: edges.reduce((sum, edge) => sum + edge.angleErrorDeg, 0) / edges.length,
    fittedSwingDeg: fitSwingDeg(strokesMm, target, cssPxPerMm),
    targetSwingDeg: target.swingDeg,
    scaleMm,
    normalizedError,
    durationMs: Math.max(...ends) - Math.min(...starts),
    drawingDurationMs: strokes.reduce((sum, stroke) => sum + (stroke.samples.at(-1)!.tMs - stroke.samples[0].tMs), 0),
    pathLengthMm: rawMm.reduce((sum, points) => sum + polylineLength(points), 0),
    strokeCount: strokes.length,
  };
  const score = Math.round(100 * Math.exp(-Math.pow(normalizedError / BOX_SCORE_SIGMA, SCORE_EXPONENT)));
  return { metrics, executionPassed: true, accuracyScore: Math.max(0, Math.min(100, score)) };
}
