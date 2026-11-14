import { pointCssPxToMm } from "./geometry";
import { analyseLineStroke } from "./lineMetrics";
import { randomBetween, seededRandom } from "./random";
import type { AnalysisResult, LineTarget, Point2, RawSample, RawStroke, TaperMetrics, TaperProfile, TaperTarget } from "./types";

/**
 * Tapered stroke drill: one straight stroke whose width, driven by Pencil pressure, should match a wanted
 * width profile. The path is only a gate; the score is the width match by position along the line.
 */

export const TAPER_METRIC_VERSION = "taper-1";
export const TAPER_SCORING_VERSION = "taper-1";

/** Generic near-linear pressure curve: pressure at or below the low end draws the thinnest line. */
export const PRESSURE_LOW = 0.03;
export const PRESSURE_HIGH = 0.5;
export const WIDTH_MIN_MM = 0.5;
export const WIDTH_MAX_MM = 3;
export const WIDTH_RANGE_MM = WIDTH_MAX_MM - WIDTH_MIN_MM;

/** Provisional; to be tuned from real sessions. */
export const TAPER_SCORE_SIGMA = 0.2;

export const TAPER_LENGTH_RANGE_MM = { minimum: 60, maximum: 110 } as const;
export const TAPER_PROFILES: readonly TaperProfile[] = ["EVEN", "THIN_TO_THICK", "THICK_TO_THIN", "THIN_THICK_THIN"];
const THIN_RANGE_MM = { minimum: 0.5, maximum: 1 } as const;
const THICK_RANGE_MM = { minimum: 2, maximum: 3 } as const;
const EVEN_RANGE_MM = { minimum: 0.8, maximum: 2.6 } as const;

/** Width is compared in this many equal slices of the line, so slow parts of the stroke don't count extra. */
export const TAPER_BINS = 20;
/** Path gate: the width samples must cover this much of the line, and the stroke must stay this close to it. */
export const MIN_TAPER_COVERAGE = 0.8;
export const MAX_TAPER_PATH_RMS_MM = 4;

export const TAPER_PROFILE_LABELS: Record<TaperProfile, string> = {
  EVEN: "even",
  THIN_TO_THICK: "thin to thick",
  THICK_TO_THIN: "thick to thin",
  THIN_THICK_THIN: "thin–thick–thin",
};

export function widthFromPressureMm(pressure: number): number {
  const amount = (Math.min(PRESSURE_HIGH, Math.max(PRESSURE_LOW, pressure)) - PRESSURE_LOW) / (PRESSURE_HIGH - PRESSURE_LOW);
  return WIDTH_MIN_MM + amount * WIDTH_RANGE_MM;
}

/**
 * Drawn width per sample in mm, or null where the browser reported no pressure. The first and last samples
 * carry placeholder pressures (about 0.08 on touch-down, 0 on lift), so they borrow their neighbour's width;
 * their positions are still used.
 */
export function strokeWidthsMm(samples: readonly RawSample[]): Array<number | null> {
  const widths = samples.map((sample) => (sample.pressure === undefined || !Number.isFinite(sample.pressure) ? null : widthFromPressureMm(sample.pressure)));
  if (widths.length >= 3) {
    widths[0] = widths[1];
    widths[widths.length - 1] = widths[widths.length - 2];
  }
  return widths;
}

/** Wanted width at fraction t (0 = start a, 1 = end b): linear from start to middle, then middle to end. */
export function targetWidthAtMm(target: TaperTarget, t: number): number {
  const [start, middle, end] = target.widthsMm;
  const clamped = Math.min(1, Math.max(0, t));
  return clamped <= 0.5 ? start + (middle - start) * clamped * 2 : middle + (end - middle) * (clamped - 0.5) * 2;
}

export function taperProfileWidths(profile: TaperProfile, thinMm: number, thickMm: number, evenMm: number): [number, number, number] {
  if (profile === "EVEN") return [evenMm, evenMm, evenMm];
  if (profile === "THIN_TO_THICK") return [thinMm, (thinMm + thickMm) / 2, thickMm];
  if (profile === "THICK_TO_THIN") return [thickMm, (thinMm + thickMm) / 2, thinMm];
  return [thinMm, thickMm, thinMm];
}

/** The three cue points: start, middle and end of the line. */
export function taperCheckpointsCss(target: TaperTarget): Point2[] {
  const { aCss: a, bCss: b } = target;
  return [a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, b];
}

/** Closed outline of the ideal stroke (sides plus round caps), in CSS px. */
export function taperOutlineCss(target: TaperTarget, cssPxPerMm: number, steps = 48): Point2[] {
  const { aCss: a, bCss: b } = target;
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const nx = -uy;
  const ny = ux;
  const half = (t: number) => (targetWidthAtMm(target, t) * cssPxPerMm) / 2;
  const left: Point2[] = [];
  const right: Point2[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    left.push({ x: x + nx * half(t), y: y + ny * half(t) });
    right.push({ x: x - nx * half(t), y: y - ny * half(t) });
  }
  const cap = (centre: Point2, radius: number, fromAngle: number): Point2[] => Array.from({ length: 11 }, (_, index) => {
    const angle = fromAngle - (Math.PI * (index + 1)) / 12;
    return { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
  });
  const normalAngle = Math.atan2(ny, nx);
  return [
    ...left,
    ...cap(b, half(1), normalAngle),
    ...right.reverse(),
    ...cap(a, half(0), normalAngle + Math.PI),
    left[0],
  ];
}

/* ---------- generation ---------- */

export function generateTaperTarget(
  viewport: { width: number; height: number },
  cssPxPerMm: number,
  sessionSeed: string,
  sequenceIndex: number,
): TaperTarget {
  const random = seededRandom(`${sessionSeed}:target:${sequenceIndex}:TAPER`);
  const margin = Math.min(72, Math.max(34, Math.min(viewport.width, viewport.height) * 0.08));
  const profile = TAPER_PROFILES[Math.floor(random() * TAPER_PROFILES.length)];
  const widthsMm = taperProfileWidths(
    profile,
    randomBetween(random, THIN_RANGE_MM.minimum, THIN_RANGE_MM.maximum),
    randomBetween(random, THICK_RANGE_MM.minimum, THICK_RANGE_MM.maximum),
    randomBetween(random, EVEN_RANGE_MM.minimum, EVEN_RANGE_MM.maximum),
  );
  const lengthMm = randomBetween(random, TAPER_LENGTH_RANGE_MM.minimum, TAPER_LENGTH_RANGE_MM.maximum);
  const inside = (point: Point2) => point.x >= margin && point.x <= viewport.width - margin && point.y >= margin && point.y <= viewport.height - margin;
  for (let attempt = 0; attempt < 220; attempt += 1) {
    const theta = randomBetween(random, 0, Math.PI * 2);
    const centre = { x: randomBetween(random, margin, viewport.width - margin), y: randomBetween(random, margin, viewport.height - margin) };
    const half = { x: (Math.cos(theta) * lengthMm * cssPxPerMm) / 2, y: (Math.sin(theta) * lengthMm * cssPxPerMm) / 2 };
    const aCss = { x: centre.x - half.x, y: centre.y - half.y };
    const bCss = { x: centre.x + half.x, y: centre.y + half.y };
    if (inside(aCss) && inside(bCss)) return { kind: "TAPER", aCss, bCss, lengthMm, profile, widthsMm };
  }
  // A tiny viewport: a horizontal line through the centre, shortened to fit.
  const fallbackLengthMm = Math.min(lengthMm, Math.max(10, (viewport.width - margin * 2) / cssPxPerMm));
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const halfCss = (fallbackLengthMm * cssPxPerMm) / 2;
  return {
    kind: "TAPER",
    aCss: { x: centre.x - halfCss, y: centre.y },
    bCss: { x: centre.x + halfCss, y: centre.y },
    lengthMm: fallbackLengthMm,
    profile,
    widthsMm,
  };
}

/* ---------- scoring ---------- */

function sectionMean(values: ReadonlyArray<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0) / present.length;
}

export function analyseTaperStroke(
  stroke: RawStroke,
  target: TaperTarget,
  cssPxPerMm: number,
  correctionGateEnabled = true,
): AnalysisResult<TaperMetrics> {
  if (stroke.samples.length === 0) throw new Error("Cannot analyse an empty stroke");
  const lineTarget: LineTarget = { kind: "LINE", aCss: target.aCss, bCss: target.bCss, lengthMm: target.lengthMm };
  const path = analyseLineStroke(stroke, lineTarget, cssPxPerMm, correctionGateEnabled);

  const a = pointCssPxToMm(target.aCss, cssPxPerMm);
  const b = pointCssPxToMm(target.bCss, cssPxPerMm);
  const lengthMm = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const widths = strokeWidthsMm(stroke.samples);
  const sums = new Array<number>(TAPER_BINS).fill(0);
  const squaredErrors = new Array<number>(TAPER_BINS).fill(0);
  const counts = new Array<number>(TAPER_BINS).fill(0);
  let widthSampleCount = 0;
  stroke.samples.forEach((sample, index) => {
    // The placeholder first and last samples are left out of the width comparison (their positions still
    // count for the path gate); the borrowed widths above are only for drawing.
    if (stroke.samples.length >= 3 && (index === 0 || index === stroke.samples.length - 1)) return;
    const width = widths[index];
    if (width === null) return;
    const point = pointCssPxToMm({ x: sample.xCss, y: sample.yCss }, cssPxPerMm);
    // Position along the line, so either drawing direction compares the same widths.
    const t = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (lengthMm * lengthMm);
    if (t < 0 || t > 1) return;
    const bin = Math.min(TAPER_BINS - 1, Math.floor(t * TAPER_BINS));
    const error = width - targetWidthAtMm(target, t);
    sums[bin] += width;
    squaredErrors[bin] += error * error;
    counts[bin] += 1;
    widthSampleCount += 1;
  });

  const occupied = counts.map((count, bin) => (count > 0 ? bin : -1)).filter((bin) => bin >= 0);
  const binMean = (bin: number): number | null => (counts[bin] > 0 ? sums[bin] / counts[bin] : null);
  const widthRmsErrorMm = occupied.length === 0
    ? 0
    : Math.sqrt(occupied.reduce((total, bin) => total + squaredErrors[bin] / counts[bin], 0) / occupied.length);
  const third = Math.round(TAPER_BINS * 0.15);
  const middleStart = Math.round(TAPER_BINS * 0.4);
  const middleEnd = Math.round(TAPER_BINS * 0.6);
  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => binMean(from + index));
  const metrics: TaperMetrics = {
    widthRmsErrorMm,
    normalizedError: widthRmsErrorMm / WIDTH_RANGE_MM,
    drawnWidthsMm: [sectionMean(range(0, third)), sectionMean(range(middleStart, middleEnd)), sectionMean(range(TAPER_BINS - third, TAPER_BINS))],
    targetWidthsMm: [...target.widthsMm],
    coverage: occupied.length / TAPER_BINS,
    widthSampleCount,
    pathRmsMm: path.metrics.rmsOrthogonalDeviationMm,
    pathEndpointMeanErrorMm: path.metrics.endpointMeanErrorMm,
    pathLengthMm: path.metrics.pathLengthMm,
    durationMs: path.metrics.durationMs,
  };

  const fail = (reason: string): AnalysisResult<TaperMetrics> => ({ metrics, executionPassed: false, executionReason: reason });
  if (!path.executionPassed) return fail(path.executionReason ?? "Stroke not scored");
  if (widths.every((width) => width === null)) return fail("No pressure reported — use Apple Pencil");
  if (metrics.coverage < MIN_TAPER_COVERAGE) return fail("Cover the whole line, end to end");
  if (metrics.pathRmsMm > MAX_TAPER_PATH_RMS_MM) return fail("Stay on the line — width is only scored along it");

  const accuracyScore = Math.round(100 * Math.exp(-Math.pow(metrics.normalizedError / TAPER_SCORE_SIGMA, 1.35)));
  return { metrics, executionPassed: true, accuracyScore: Math.max(0, Math.min(100, accuracyScore)) };
}

/* ---------- display ---------- */

function formatWidth(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

/** One line of the measurements behind a taper score, shared by the feedback card and the trophy case. */
export function taperMetricText(metrics: TaperMetrics): string {
  const drawn = metrics.drawnWidthsMm.map(formatWidth).join("/");
  const wanted = metrics.targetWidthsMm.map((value) => value.toFixed(1)).join("/");
  return `Width error ${metrics.widthRmsErrorMm.toFixed(1)} mm · start/mid/end ${drawn} vs ${wanted} mm · path ${metrics.pathRmsMm.toFixed(1)} mm`;
}
