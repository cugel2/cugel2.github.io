import { pointCssPxToMm, polylineLength, resampleByArcLength, wrapAngleRad } from "./geometry";
import type { LineMetrics, LineTarget, Point2, RawStroke } from "./types";

export const METRIC_VERSION = "line-1";
export const SCORING_VERSION = "line-1";

export interface LineAnalysis {
  metrics: LineMetrics;
  executionPassed: boolean;
  executionReason?: string;
  accuracyScore?: number;
}

function distance(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function orthogonalDistance(point: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return distance(point, a);
  return Math.abs(dx * (a.y - point.y) - (a.x - point.x) * dy) / length;
}

function totalTurning(points: readonly Point2[]): number {
  const headings: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index].x - points[index - 1].x;
    const dy = points[index].y - points[index - 1].y;
    if (Math.hypot(dx, dy) > 0.05) headings.push(Math.atan2(dy, dx));
  }

  let turning = 0;
  for (let index = 1; index < headings.length; index += 1) {
    turning += Math.abs(wrapAngleRad(headings[index] - headings[index - 1]));
  }
  return turning;
}

function executionFailure(metrics: LineMetrics, sampleCount: number, targetLengthMm: number): string | undefined {
  if (sampleCount < 8) return "Stroke too short — try again";
  if (metrics.pathLengthMm < Math.max(20, targetLengthMm * 0.45)) return "Stroke too short — reach the other point";
  if (metrics.durationMs <= 0) return "Couldn’t evaluate the stroke timing";
  if (metrics.durationMs / Math.max(metrics.pathLengthMm, 1) > 35) return "Too slow — make one committed movement";
  if (metrics.pathEfficiency < 0.5 || metrics.totalTurningRad > 3.2) return "Too corrective — commit to the next one";
  return undefined;
}

export function analyseLineStroke(
  stroke: RawStroke,
  target: LineTarget,
  cssPxPerMm: number,
): LineAnalysis {
  if (stroke.samples.length === 0) throw new Error("Cannot analyse an empty stroke");

  const pointsMm = stroke.samples.map((sample) => pointCssPxToMm({ x: sample.xCss, y: sample.yCss }, cssPxPerMm));
  const targetA = pointCssPxToMm(target.aCss, cssPxPerMm);
  const targetB = pointCssPxToMm(target.bCss, cssPxPerMm);
  const geometryPath = resampleByArcLength(pointsMm, 256);
  const turningPath = resampleByArcLength(pointsMm, Math.min(64, Math.max(8, pointsMm.length)));
  const first = geometryPath[0];
  const last = geometryPath.at(-1)!;

  const forwardError = distance(first, targetA) + distance(last, targetB);
  const reverseError = distance(first, targetB) + distance(last, targetA);
  const startTarget = forwardError <= reverseError ? targetA : targetB;
  const endTarget = forwardError <= reverseError ? targetB : targetA;
  const startError = distance(first, startTarget);
  const endError = distance(last, endTarget);
  const deviations = geometryPath.map((point) => orthogonalDistance(point, targetA, targetB));
  const rmsDeviation = Math.sqrt(deviations.reduce((sum, value) => sum + value * value, 0) / deviations.length);
  const pathLengthMm = polylineLength(pointsMm);
  const chordLengthMm = distance(pointsMm[0], pointsMm.at(-1)!);
  const durationMs = stroke.samples.at(-1)!.tMs - stroke.samples[0].tMs;
  const targetLengthMm = distance(targetA, targetB);
  const endpointMean = (startError + endError) / 2;
  const normalizedError = Math.hypot(rmsDeviation, endpointMean * 0.6) / Math.max(targetLengthMm, 1);

  const metrics: LineMetrics = {
    endpointStartErrorMm: startError,
    endpointEndErrorMm: endError,
    endpointMeanErrorMm: endpointMean,
    rmsOrthogonalDeviationMm: rmsDeviation,
    maxOrthogonalDeviationMm: Math.max(...deviations),
    pathLengthMm,
    pathEfficiency: pathLengthMm > 0 ? Math.min(1, chordLengthMm / pathLengthMm) : 0,
    totalTurningRad: totalTurning(turningPath),
    durationMs,
    meanSpeedMmS: durationMs > 0 ? pathLengthMm / (durationMs / 1000) : 0,
    normalizedError,
  };

  const failure = executionFailure(metrics, stroke.samples.length, targetLengthMm);
  if (failure) return { metrics, executionPassed: false, executionReason: failure };

  const accuracyScore = Math.round(100 * Math.exp(-Math.pow(normalizedError / 0.06, 1.35)));
  return {
    metrics,
    executionPassed: true,
    accuracyScore: Math.max(0, Math.min(100, accuracyScore)),
  };
}
