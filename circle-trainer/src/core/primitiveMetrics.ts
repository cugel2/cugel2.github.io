import { pointCssPxToMm, polylineLength, resampleByArcLength, wrapAngleRad } from "./geometry";
import { analyseLineStroke, METRIC_VERSION as LINE_METRIC_VERSION, SCORING_VERSION as LINE_SCORING_VERSION } from "./lineMetrics";
import { sampleTargetPathCss, targetPathLengthMm } from "./targets";
import type {
  AnalysisResult,
  ArcMetrics,
  ArcTarget,
  CircleMetrics,
  CircleTarget,
  EllipseMetrics,
  EllipseTarget,
  ExerciseType,
  Point2,
  PrimitiveMetrics,
  RawStroke,
  SCurveMetrics,
  SCurveTarget,
  TargetDefinition,
} from "./types";

const VERSIONS: Record<ExerciseType, { metric: string; scoring: string }> = {
  LINE: { metric: LINE_METRIC_VERSION, scoring: LINE_SCORING_VERSION },
  ARC: { metric: "arc-2", scoring: "arc-1" },
  CIRCLE: { metric: "circle-1", scoring: "circle-1" },
  ELLIPSE: { metric: "ellipse-1", scoring: "ellipse-1" },
  S_CURVE: { metric: "s-curve-1", scoring: "s-curve-1" },
};

export function versionsForExercise(type: ExerciseType): { metric: string; scoring: string } {
  return VERSIONS[type];
}

function distance(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointsFromStroke(stroke: RawStroke, cssPxPerMm: number): Point2[] {
  return stroke.samples.map((sample) => pointCssPxToMm({ x: sample.xCss, y: sample.yCss }, cssPxPerMm));
}

function referencePathMm(target: TargetDefinition, cssPxPerMm: number, count = 512): Point2[] {
  return sampleTargetPathCss(target, cssPxPerMm, count).map((point) => pointCssPxToMm(point, cssPxPerMm));
}

function pointSegmentDistance(point: Point2, start: Point2, end: Point2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, { x: start.x + dx * amount, y: start.y + dy * amount });
}

function distancesToPolyline(points: readonly Point2[], reference: readonly Point2[]): number[] {
  return points.map((point) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 1; index < reference.length; index += 1) {
      nearest = Math.min(nearest, pointSegmentDistance(point, reference[index - 1], reference[index]));
    }
    return nearest;
  });
}

function rms(values: readonly number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length));
}

function symmetricDistances(userPath: readonly Point2[], reference: readonly Point2[]): {
  userRms: number;
  reverseRms: number;
  combinedRms: number;
  maximum: number;
} {
  const forward = distancesToPolyline(userPath, reference);
  const reverse = distancesToPolyline(reference, userPath);
  const userRms = rms(forward);
  const reverseRms = rms(reverse);
  return {
    userRms,
    reverseRms,
    combinedRms: Math.hypot(userRms, reverseRms) / Math.SQRT2,
    maximum: Math.max(...forward),
  };
}

function endpointMeanError(userPath: readonly Point2[], reference: readonly Point2[]): number {
  const first = userPath[0];
  const last = userPath.at(-1)!;
  const refFirst = reference[0];
  const refLast = reference.at(-1)!;
  return Math.min(
    (distance(first, refFirst) + distance(last, refLast)) / 2,
    (distance(first, refLast) + distance(last, refFirst)) / 2,
  );
}

function unwrapCoverage(phases: readonly number[]): number {
  if (phases.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < phases.length; index += 1) {
    total += wrapAngleRad(phases[index] - phases[index - 1]);
  }
  return Math.abs(total);
}

function angularVariation(phases: readonly number[]): number {
  let total = 0;
  for (let index = 1; index < phases.length; index += 1) {
    total += Math.abs(wrapAngleRad(phases[index] - phases[index - 1]));
  }
  return total;
}

function curvatureSignTransitions(points: readonly Point2[]): number {
  const path = resampleByArcLength(points, Math.min(64, Math.max(8, points.length)));
  let previousSign = 0;
  let transitions = 0;
  for (let index = 2; index < path.length; index += 1) {
    const firstHeading = Math.atan2(path[index - 1].y - path[index - 2].y, path[index - 1].x - path[index - 2].x);
    const secondHeading = Math.atan2(path[index].y - path[index - 1].y, path[index].x - path[index - 1].x);
    const turn = wrapAngleRad(secondHeading - firstHeading);
    if (Math.abs(turn) < 0.015) continue;
    const sign = Math.sign(turn);
    if (previousSign !== 0 && sign !== previousSign) transitions += 1;
    previousSign = sign;
  }
  return transitions;
}

function baseFailure(stroke: RawStroke, pathLengthMm: number, expectedLengthMm: number): string | undefined {
  if (stroke.samples.length < 12) return "Stroke too short — try again";
  if (pathLengthMm < expectedLengthMm * 0.5) return "Stroke incomplete — reach the whole shape";
  const durationMs = stroke.samples.at(-1)!.tMs - stroke.samples[0].tMs;
  if (durationMs <= 0) return "Couldn’t evaluate the stroke timing";
  if (durationMs / Math.max(pathLengthMm, 1) > 35) return "Too slow — make one committed movement";
  return undefined;
}

function score(normalizedError: number, sigma: number): number {
  return Math.max(0, Math.min(100, Math.round(100 * Math.exp(-Math.pow(normalizedError / sigma, 1.35)))));
}

function analyseCircle(stroke: RawStroke, target: CircleTarget, cssPxPerMm: number): AnalysisResult<CircleMetrics> {
  const points = pointsFromStroke(stroke, cssPxPerMm);
  const path = resampleByArcLength(points, 256);
  const center = pointCssPxToMm(target.centerCss, cssPxPerMm);
  const residuals = path.map((point) => Math.abs(distance(point, center) - target.radiusMm));
  const phases = path.map((point) => Math.atan2(point.y - center.y, point.x - center.x));
  const coverage = unwrapCoverage(phases);
  const pathLengthMm = polylineLength(points);
  const expectedLength = Math.PI * 2 * target.radiusMm;
  const durationMs = stroke.samples.at(-1)!.tMs - stroke.samples[0].tMs;
  const closureMm = distance(path[0], path.at(-1)!);
  const radialRmsMm = rms(residuals);
  const coverageError = Math.abs(coverage - Math.PI * 2) / (Math.PI * 2);
  const normalizedError = Math.hypot(radialRmsMm / target.radiusMm, closureMm / (target.radiusMm * 2) * 0.35, coverageError * 0.18);
  const transitions = curvatureSignTransitions(path);
  const metrics: CircleMetrics = {
    durationMs,
    pathLengthMm,
    meanSpeedMmS: durationMs > 0 ? pathLengthMm / (durationMs / 1000) : 0,
    rmsDeviationMm: radialRmsMm,
    maxDeviationMm: Math.max(...residuals),
    normalizedError,
    radialRmsMm,
    radialMaxMm: Math.max(...residuals),
    closureMm,
    angularCoverageRad: coverage,
    curvatureSignReversals: transitions,
  };
  const failure = baseFailure(stroke, pathLengthMm, expectedLength)
    ?? (coverage < Math.PI * 1.55 || coverage > Math.PI * 2.45 ? "Incomplete loop — make one full circle" : undefined)
    ?? (angularVariation(phases) - coverage > Math.PI * 0.45 ? "Too corrective — commit to the next one" : undefined)
    ?? (transitions > 10 ? "Too corrective — commit to the next one" : undefined);
  return failure ? { metrics, executionPassed: false, executionReason: failure } : { metrics, executionPassed: true, accuracyScore: score(normalizedError, 0.1) };
}

function analyseEllipse(stroke: RawStroke, target: EllipseTarget, cssPxPerMm: number): AnalysisResult<EllipseMetrics> {
  const points = pointsFromStroke(stroke, cssPxPerMm);
  const path = resampleByArcLength(points, 256);
  const reference = referencePathMm(target, cssPxPerMm);
  const distances = symmetricDistances(path, reference);
  const center = pointCssPxToMm(target.centerCss, cssPxPerMm);
  const cosine = Math.cos(-target.thetaRad);
  const sine = Math.sin(-target.thetaRad);
  const canonical = path.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return { x: dx * cosine - dy * sine, y: dx * sine + dy * cosine };
  });
  const phases = canonical.map((point) => Math.atan2(point.y / target.bMm, point.x / target.aMm));
  const canonicalResiduals = canonical.map((point) => Math.abs(Math.hypot(point.x / target.aMm, point.y / target.bMm) - 1));
  const coverage = unwrapCoverage(phases);
  const pathLengthMm = polylineLength(points);
  const expectedLength = targetPathLengthMm(target, cssPxPerMm);
  const durationMs = stroke.samples.at(-1)!.tMs - stroke.samples[0].tMs;
  const closureMm = distance(path[0], path.at(-1)!);
  const coverageError = Math.abs(coverage - Math.PI * 2) / (Math.PI * 2);
  const normalizedError = Math.hypot(distances.combinedRms / (target.aMm * 2), closureMm / (target.aMm * 2) * 0.35, coverageError * 0.16);
  const transitions = curvatureSignTransitions(path);
  const metrics: EllipseMetrics = {
    durationMs,
    pathLengthMm,
    meanSpeedMmS: durationMs > 0 ? pathLengthMm / (durationMs / 1000) : 0,
    rmsDeviationMm: distances.combinedRms,
    maxDeviationMm: distances.maximum,
    normalizedError,
    closureMm,
    angularCoverageRad: coverage,
    reverseCoverageRmsMm: distances.reverseRms,
    canonicalRadialRms: rms(canonicalResiduals),
    curvatureSignReversals: transitions,
  };
  const failure = baseFailure(stroke, pathLengthMm, expectedLength)
    ?? (coverage < Math.PI * 1.55 || coverage > Math.PI * 2.45 ? "Incomplete loop — make one full ellipse" : undefined)
    ?? (angularVariation(phases) - coverage > Math.PI * 0.45 ? "Too corrective — commit to the next one" : undefined)
    ?? (transitions > 12 ? "Too corrective — commit to the next one" : undefined);
  return failure ? { metrics, executionPassed: false, executionReason: failure } : { metrics, executionPassed: true, accuracyScore: score(normalizedError, 0.065) };
}

function analyseArc(stroke: RawStroke, target: ArcTarget, cssPxPerMm: number): AnalysisResult<ArcMetrics> {
  const points = pointsFromStroke(stroke, cssPxPerMm);
  const path = resampleByArcLength(points, 256);
  const reference = referencePathMm(target, cssPxPerMm);
  const distances = symmetricDistances(path, reference);
  const center = pointCssPxToMm(target.centerCss, cssPxPerMm);
  const phases = path.map((point) => Math.atan2(point.y - center.y, point.x - center.x));
  const coverage = unwrapCoverage(phases);
  const expectedSweep = Math.abs(target.sweepRad);
  const pathLengthMm = polylineLength(points);
  const expectedLength = target.radiusMm * expectedSweep;
  const durationMs = stroke.samples.at(-1)!.tMs - stroke.samples[0].tMs;
  const endpointError = endpointMeanError(path, reference);
  const coverageError = Math.abs(coverage - expectedSweep) / expectedSweep;
  const normalizedError = Math.hypot(distances.combinedRms / expectedLength, endpointError * 0.6 / expectedLength, coverageError * 0.16);
  const transitions = curvatureSignTransitions(path);
  const gatePath = resampleByArcLength(points, Math.min(64, Math.max(12, points.length)));
  const gatePhases = gatePath.map((point) => Math.atan2(point.y - center.y, point.x - center.x));
  const metrics: ArcMetrics = {
    durationMs,
    pathLengthMm,
    meanSpeedMmS: durationMs > 0 ? pathLengthMm / (durationMs / 1000) : 0,
    rmsDeviationMm: distances.combinedRms,
    maxDeviationMm: distances.maximum,
    normalizedError,
    endpointMeanErrorMm: endpointError,
    angularCoverageRad: coverage,
    expectedSweepRad: expectedSweep,
    overshootRad: Math.max(0, coverage - expectedSweep),
    pathLengthRatio: pathLengthMm / expectedLength,
    curvatureSignReversals: transitions,
  };
  const failure = baseFailure(stroke, pathLengthMm, expectedLength)
    ?? (coverage < expectedSweep * 0.62 || coverage > expectedSweep * 1.55 ? "Incomplete arc — pass through all three points" : undefined)
    ?? (angularVariation(gatePhases) - unwrapCoverage(gatePhases) > expectedSweep * 0.45 ? "Too corrective — commit to the next one" : undefined);
  return failure ? { metrics, executionPassed: false, executionReason: failure } : { metrics, executionPassed: true, accuracyScore: score(normalizedError, 0.06) };
}

function nearestReferenceIndices(points: readonly Point2[], reference: readonly Point2[]): number[] {
  return points.map((point) => {
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < reference.length; index += 1) {
      const candidate = distance(point, reference[index]);
      if (candidate < nearestDistance) {
        nearestDistance = candidate;
        nearestIndex = index;
      }
    }
    return nearestIndex;
  });
}

function analyseSCurve(stroke: RawStroke, target: SCurveTarget, cssPxPerMm: number): AnalysisResult<SCurveMetrics> {
  const points = pointsFromStroke(stroke, cssPxPerMm);
  const path = resampleByArcLength(points, 256);
  const reference = referencePathMm(target, cssPxPerMm);
  const distances = symmetricDistances(path, reference);
  const endpointError = endpointMeanError(path, reference);
  const forward = distance(path[0], reference[0]) + distance(path.at(-1)!, reference.at(-1)!);
  let indices = nearestReferenceIndices(path, reference);
  if (forward > distance(path[0], reference.at(-1)!) + distance(path.at(-1)!, reference[0])) {
    indices = indices.map((index) => reference.length - 1 - index);
  }
  const progression = (Math.max(...indices) - Math.min(...indices)) / (reference.length - 1);
  let backward = 0;
  let totalProgress = 0;
  for (let index = 1; index < indices.length; index += 1) {
    const delta = indices[index] - indices[index - 1];
    totalProgress += Math.abs(delta);
    if (delta < 0) backward += Math.abs(delta);
  }
  const backtrackingFraction = totalProgress > 0 ? backward / totalProgress : 1;
  const pathLengthMm = polylineLength(points);
  const expectedLength = targetPathLengthMm(target, cssPxPerMm);
  const durationMs = stroke.samples.at(-1)!.tMs - stroke.samples[0].tMs;
  const pathLengthRatio = pathLengthMm / expectedLength;
  const transitions = curvatureSignTransitions(path);
  const normalizedError = Math.hypot(distances.combinedRms / expectedLength, endpointError * 0.6 / expectedLength, (1 - progression) * 0.14);
  const metrics: SCurveMetrics = {
    durationMs,
    pathLengthMm,
    meanSpeedMmS: durationMs > 0 ? pathLengthMm / (durationMs / 1000) : 0,
    rmsDeviationMm: distances.combinedRms,
    maxDeviationMm: distances.maximum,
    normalizedError,
    endpointMeanErrorMm: endpointError,
    reverseCoverageRmsMm: distances.reverseRms,
    progression,
    backtrackingFraction,
    pathLengthRatio,
    curvatureSignTransitions: transitions,
  };
  const failure = baseFailure(stroke, pathLengthMm, expectedLength)
    ?? (progression < 0.72 ? "Incomplete S curve — pass through all four points" : undefined)
    ?? (transitions < 1 ? "Wrong curve — make two opposing lobes" : undefined)
    ?? (backtrackingFraction > 0.14 || pathLengthRatio > 1.42 || transitions > 8 ? "Too corrective — commit to the next one" : undefined);
  return failure ? { metrics, executionPassed: false, executionReason: failure } : { metrics, executionPassed: true, accuracyScore: score(normalizedError, 0.055) };
}

export function analyseTargetStroke(stroke: RawStroke, target: TargetDefinition, cssPxPerMm: number): AnalysisResult<PrimitiveMetrics> {
  if (stroke.samples.length === 0) throw new Error("Cannot analyse an empty stroke");
  if (target.kind === "LINE") return analyseLineStroke(stroke, target, cssPxPerMm);
  if (target.kind === "ARC") return analyseArc(stroke, target, cssPxPerMm);
  if (target.kind === "CIRCLE") return analyseCircle(stroke, target, cssPxPerMm);
  if (target.kind === "ELLIPSE") return analyseEllipse(stroke, target, cssPxPerMm);
  return analyseSCurve(stroke, target, cssPxPerMm);
}
