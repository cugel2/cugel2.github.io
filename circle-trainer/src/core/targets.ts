import { randomBetween, seededRandom, type RandomSource } from "./random";
import type { EllipseTarget, ExerciseType, Point2, TargetDefinition } from "./types";

export interface ViewportSize {
  width: number;
  height: number;
}

function rotate(point: Point2, theta: number): Point2 {
  const cosine = Math.cos(theta);
  const sine = Math.sin(theta);
  return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine };
}

function ellipsePoint(target: EllipseTarget, phase: number, cssPxPerMm: number): Point2 {
  const local = rotate({ x: target.aMm * cssPxPerMm * Math.cos(phase), y: target.bMm * cssPxPerMm * Math.sin(phase) }, target.thetaRad);
  return { x: target.centerCss.x + local.x, y: target.centerCss.y + local.y };
}

export function sampleTargetPathCss(target: TargetDefinition, cssPxPerMm: number, count = 256): Point2[] {
  const points: Point2[] = [];
  const samples = Math.max(2, count);
  for (let index = 0; index < samples; index += 1) {
    const t = index / (samples - 1);
    if (target.kind === "LINE") {
      points.push({
        x: target.aCss.x + (target.bCss.x - target.aCss.x) * t,
        y: target.aCss.y + (target.bCss.y - target.aCss.y) * t,
      });
    } else if (target.kind === "ARC") {
      const phase = target.startAngleRad + target.sweepRad * t;
      const radiusCss = target.radiusMm * cssPxPerMm;
      points.push({ x: target.centerCss.x + Math.cos(phase) * radiusCss, y: target.centerCss.y + Math.sin(phase) * radiusCss });
    } else if (target.kind === "CIRCLE") {
      const phase = target.landmarkPhaseRad + Math.PI * 2 * t;
      const radiusCss = target.radiusMm * cssPxPerMm;
      points.push({ x: target.centerCss.x + Math.cos(phase) * radiusCss, y: target.centerCss.y + Math.sin(phase) * radiusCss });
    } else if (target.kind === "ELLIPSE") {
      points.push(ellipsePoint(target, Math.PI * 2 * t, cssPxPerMm));
    } else {
      const lengthCss = target.lengthMm * cssPxPerMm;
      const amplitude = (target.amplitudeStartMm * (1 - t) + target.amplitudeEndMm * t) * cssPxPerMm;
      const local = rotate({ x: (t - 0.5) * lengthCss, y: Math.sin(Math.PI * 2 * t) * amplitude }, target.thetaRad);
      points.push({ x: target.centerCss.x + local.x, y: target.centerCss.y + local.y });
    }
  }
  return points;
}

export function targetCheckpointsCss(target: TargetDefinition, cssPxPerMm: number): Point2[] {
  if (target.kind === "LINE") return [target.aCss, target.bCss];
  if (target.kind === "ARC") return [0, 0.5, 1].map((t) => sampleTargetPathCss(target, cssPxPerMm, 3)[Math.round(t * 2)]);
  if (target.kind === "CIRCLE") return [0, 0.25, 0.5, 0.75].map((t) => {
    const phase = target.landmarkPhaseRad + Math.PI * 2 * t;
    const radiusCss = target.radiusMm * cssPxPerMm;
    return { x: target.centerCss.x + Math.cos(phase) * radiusCss, y: target.centerCss.y + Math.sin(phase) * radiusCss };
  });
  if (target.kind === "ELLIPSE") return [0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((phase) => ellipsePoint(target, phase, cssPxPerMm));
  const path = sampleTargetPathCss(target, cssPxPerMm, 101);
  return [path[0], path[25], path[75], path[100]];
}

function targetFits(target: TargetDefinition, viewport: ViewportSize, cssPxPerMm: number, margin: number): boolean {
  return sampleTargetPathCss(target, cssPxPerMm, 160).every((point) => (
    point.x >= margin && point.x <= viewport.width - margin && point.y >= margin && point.y <= viewport.height - margin
  ));
}

function randomCenter(random: RandomSource, viewport: ViewportSize, margin: number): Point2 {
  return {
    x: randomBetween(random, margin, viewport.width - margin),
    y: randomBetween(random, margin, viewport.height - margin),
  };
}

function candidateTarget(type: ExerciseType, viewport: ViewportSize, cssPxPerMm: number, random: RandomSource, margin: number): TargetDefinition {
  const drawableWidth = viewport.width - margin * 2;
  const drawableHeight = viewport.height - margin * 2;
  const shortSide = Math.min(drawableWidth, drawableHeight);
  const longSide = Math.max(drawableWidth, drawableHeight);
  const theta = randomBetween(random, 0, Math.PI * 2);
  const centerCss = randomCenter(random, viewport, margin);

  if (type === "LINE") {
    const lengthCss = randomBetween(random, shortSide * 0.55, longSide * 0.85);
    const half = rotate({ x: lengthCss / 2, y: 0 }, theta);
    return {
      kind: "LINE",
      aCss: { x: centerCss.x - half.x, y: centerCss.y - half.y },
      bCss: { x: centerCss.x + half.x, y: centerCss.y + half.y },
      lengthMm: lengthCss / cssPxPerMm,
    };
  }
  if (type === "ARC") {
    const sweepMagnitude = randomBetween(random, 70, 170) * Math.PI / 180;
    const sweepRad = random() < 0.5 ? sweepMagnitude : -sweepMagnitude;
    const radiusCss = randomBetween(random, shortSide * 0.28, shortSide * 0.52);
    return { kind: "ARC", centerCss, radiusMm: radiusCss / cssPxPerMm, startAngleRad: theta, sweepRad };
  }
  if (type === "CIRCLE") {
    const radiusCss = randomBetween(random, shortSide * 0.275, shortSide * 0.425);
    return { kind: "CIRCLE", centerCss, radiusMm: radiusCss / cssPxPerMm, landmarkPhaseRad: theta };
  }
  if (type === "ELLIPSE") {
    const aCss = randomBetween(random, shortSide * 0.3, shortSide * 0.45);
    const ratio = randomBetween(random, 0.35, 0.78);
    return { kind: "ELLIPSE", centerCss, aMm: aCss / cssPxPerMm, bMm: aCss * ratio / cssPxPerMm, thetaRad: theta };
  }
  const lengthCss = randomBetween(random, shortSide * 0.65, longSide * 0.88);
  const baseAmplitudeCss = randomBetween(random, lengthCss * 0.15, lengthCss * 0.26);
  const balance = randomBetween(random, 0.78, 1.22);
  return {
    kind: "S_CURVE",
    centerCss,
    lengthMm: lengthCss / cssPxPerMm,
    amplitudeStartMm: baseAmplitudeCss / cssPxPerMm,
    amplitudeEndMm: baseAmplitudeCss * balance / cssPxPerMm,
    thetaRad: theta,
  };
}

function fallbackTarget(type: ExerciseType, viewport: ViewportSize, cssPxPerMm: number): TargetDefinition {
  const centerCss = { x: viewport.width / 2, y: viewport.height / 2 };
  const span = Math.min(viewport.width, viewport.height) * 0.62;
  if (type === "LINE") return { kind: "LINE", aCss: { x: centerCss.x - span / 2, y: centerCss.y }, bCss: { x: centerCss.x + span / 2, y: centerCss.y }, lengthMm: span / cssPxPerMm };
  if (type === "ARC") return { kind: "ARC", centerCss: { x: centerCss.x, y: centerCss.y + span * 0.2 }, radiusMm: span * 0.42 / cssPxPerMm, startAngleRad: Math.PI * 1.15, sweepRad: Math.PI * 0.7 };
  if (type === "CIRCLE") return { kind: "CIRCLE", centerCss, radiusMm: span * 0.5 / cssPxPerMm, landmarkPhaseRad: 0 };
  if (type === "ELLIPSE") return { kind: "ELLIPSE", centerCss, aMm: span * 0.5 / cssPxPerMm, bMm: span * 0.28 / cssPxPerMm, thetaRad: 0 };
  return { kind: "S_CURVE", centerCss, lengthMm: span / cssPxPerMm, amplitudeStartMm: span * 0.18 / cssPxPerMm, amplitudeEndMm: span * 0.18 / cssPxPerMm, thetaRad: 0 };
}

export function generateTarget(
  type: ExerciseType,
  viewport: ViewportSize,
  cssPxPerMm: number,
  sessionSeed: string,
  sequenceIndex: number,
): TargetDefinition {
  const random = seededRandom(`${sessionSeed}:target:${sequenceIndex}:${type}`);
  const margin = Math.min(72, Math.max(34, Math.min(viewport.width, viewport.height) * 0.08));
  for (let attempt = 0; attempt < 220; attempt += 1) {
    const candidate = candidateTarget(type, viewport, cssPxPerMm, random, margin);
    if (targetFits(candidate, viewport, cssPxPerMm, margin)) return candidate;
  }
  return fallbackTarget(type, viewport, cssPxPerMm);
}

export function targetPathLengthMm(target: TargetDefinition, cssPxPerMm: number): number {
  const path = sampleTargetPathCss(target, cssPxPerMm, 512);
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += Math.hypot(path[index].x - path[index - 1].x, path[index].y - path[index - 1].y) / cssPxPerMm;
  }
  return total;
}
