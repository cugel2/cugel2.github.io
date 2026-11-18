/**
 * Synthetic Pencil strokes for the golden tests. Everything is made from fixed seeds, never from real exports,
 * so the same strokes come out on every run.
 */
import { seededRandom, type Point2, type RawSample, type RawStroke } from "./api";

/** About an iPad's css px per mm, and the canvas sizes the app sees in landscape and portrait. */
export const PX_PER_MM = 5.2;
export const VIEWPORTS = {
  landscape: { width: 1180, height: 690 },
  portrait: { width: 820, height: 1050 },
  tiny: { width: 160, height: 140 },
} as const;

export interface StrokeOptions {
  seed: string;
  /** Wobble in mm, added independently to every sample. */
  jitterMm?: number;
  /** Pressure for each sample (by index and the sample's fraction along the stroke); undefined leaves it out. */
  pressure?: (index: number, fraction: number) => number | undefined;
  startMs?: number;
  stepMs?: number;
  id?: string;
}

/** Points at even spacing along a polyline. */
export function resample(points: readonly Point2[], count: number): Point2[] {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
  }
  const total = lengths.at(-1)!;
  const result: Point2[] = [];
  let segment = 1;
  for (let index = 0; index < count; index += 1) {
    const wanted = (total * index) / (count - 1);
    while (segment < points.length - 1 && lengths[segment] < wanted) segment += 1;
    const span = lengths[segment] - lengths[segment - 1];
    const t = span === 0 ? 0 : (wanted - lengths[segment - 1]) / span;
    const a = points[segment - 1];
    const b = points[segment];
    result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return result;
}

/** A stroke through the given css points, one sample per point, with seeded wobble. */
export function strokeFrom(points: readonly Point2[], options: StrokeOptions): RawStroke {
  const random = seededRandom(`golden-stroke:${options.seed}`);
  const jitterCss = (options.jitterMm ?? 0) * PX_PER_MM;
  const startMs = options.startMs ?? 1_000;
  const stepMs = options.stepMs ?? 8;
  // A smooth, hand-like wander (two slow waves per axis) plus a trace of sample noise, both scaled by jitterMm.
  const waves = [0, 1].map(() => ({
    slow: 1 + random(), fast: 3 + random() * 2, phaseSlow: random() * Math.PI * 2, phaseFast: random() * Math.PI * 2,
  }));
  const wander = (axis: number, t: number) => {
    const wave = waves[axis];
    return 0.65 * Math.sin(Math.PI * 2 * wave.slow * t + wave.phaseSlow) + 0.3 * Math.sin(Math.PI * 2 * wave.fast * t + wave.phaseFast);
  };
  const samples: RawSample[] = points.map((point, index) => {
    const fraction = points.length === 1 ? 0 : index / (points.length - 1);
    const sample: RawSample = {
      xCss: point.x + jitterCss * (wander(0, fraction) + (random() - 0.5) * 0.1),
      yCss: point.y + jitterCss * (wander(1, fraction) + (random() - 0.5) * 0.1),
      tMs: startMs + index * stepMs,
      sourceEventType: index === 0 ? "pointerdown" : index === points.length - 1 ? "pointerup" : "pointermove",
    };
    const pressure = options.pressure ? options.pressure(index, fraction) : 0.25;
    if (pressure !== undefined) sample.pressure = pressure;
    return sample;
  });
  return {
    id: options.id ?? `stroke-${options.seed}`,
    pointerType: "pen",
    startedAtEpochMs: 1_700_000_000_000 + startMs,
    completedAtEpochMs: 1_700_000_000_000 + startMs + (points.length - 1) * stepMs,
    cancelled: false,
    samples,
  };
}

/** The part of a path between two fractions of its samples (either order, so it can run backwards). */
export function portion(points: readonly Point2[], from: number, to: number): Point2[] {
  const last = points.length - 1;
  const a = Math.round(from * last);
  const b = Math.round(to * last);
  if (a <= b) return points.slice(a, b + 1);
  return points.slice(b, a + 1).reverse();
}

/** Scaled about the centroid (an over- or undersized drawing). */
export function scaled(points: readonly Point2[], factor: number): Point2[] {
  const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  return points.map((point) => ({ x: cx + (point.x - cx) * factor, y: cy + (point.y - cy) * factor }));
}

export function shifted(points: readonly Point2[], dxMm: number, dyMm: number): Point2[] {
  return points.map((point) => ({ x: point.x + dxMm * PX_PER_MM, y: point.y + dyMm * PX_PER_MM }));
}
