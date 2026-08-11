import type { Point2 } from "./types";

export function cssPxToMm(valueCssPx: number, cssPxPerMm: number): number {
  if (!Number.isFinite(cssPxPerMm) || cssPxPerMm <= 0) {
    throw new RangeError("cssPxPerMm must be a positive finite number");
  }
  return valueCssPx / cssPxPerMm;
}

export function pointCssPxToMm(point: Point2, cssPxPerMm: number): Point2 {
  return {
    x: cssPxToMm(point.x, cssPxPerMm),
    y: cssPxToMm(point.y, cssPxPerMm),
  };
}

export function cumulativeArcLength(points: readonly Point2[]): number[] {
  if (points.length === 0) return [];

  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    lengths.push(lengths[index - 1] + Math.hypot(current.x - previous.x, current.y - previous.y));
  }
  return lengths;
}

export function polylineLength(points: readonly Point2[]): number {
  const lengths = cumulativeArcLength(points);
  return lengths.at(-1) ?? 0;
}

export function wrapAngleRad(angle: number): number {
  let wrapped = angle;
  while (wrapped <= -Math.PI) wrapped += Math.PI * 2;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  return wrapped;
}

export function resampleByArcLength(points: readonly Point2[], count: number): Point2[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError("count must be a positive integer");
  }
  if (points.length === 0) return [];
  if (count === 1) return [{ ...points[0] }];

  const lengths = cumulativeArcLength(points);
  const total = lengths[lengths.length - 1];
  if (total === 0) return Array.from({ length: count }, () => ({ ...points[0] }));

  const result: Point2[] = [];
  let segment = 1;

  for (let index = 0; index < count; index += 1) {
    const target = (total * index) / (count - 1);
    while (segment < lengths.length - 1 && lengths[segment] < target) segment += 1;

    const startLength = lengths[segment - 1];
    const endLength = lengths[segment];
    const span = endLength - startLength;
    const amount = span === 0 ? 0 : (target - startLength) / span;
    const start = points[segment - 1];
    const end = points[segment];
    result.push({
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
    });
  }

  return result;
}
