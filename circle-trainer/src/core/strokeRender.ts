/**
 * Pressure-width stroke drawing shared by Tapers and Copy mode. Each segment
 * is stroked at the mean of its two end widths, with a round dot at the start.
 */

/** The parts of a 2D context this uses, so tests can pass a recorder. */
export type StrokeContext = Pick<
  CanvasRenderingContext2D,
  "save" | "restore" | "beginPath" | "arc" | "fill" | "moveTo" | "lineTo" | "stroke" | "setLineDash"
  | "strokeStyle" | "fillStyle" | "lineCap" | "lineWidth"
>;

export interface StrokePoint { x: number; y: number }

/** Draws `points` with per-point widths in px (`widths.length === points.length`). */
export function drawVariableWidthStroke(context: StrokeContext, points: readonly StrokePoint[], widths: readonly number[], colour = "#171717"): void {
  if (points.length === 0) return;
  context.save();
  context.strokeStyle = colour;
  context.fillStyle = colour;
  context.setLineDash([]);
  context.lineCap = "round";
  context.beginPath();
  context.arc(points[0].x, points[0].y, widths[0] / 2, 0, Math.PI * 2);
  context.fill();
  for (let index = 1; index < points.length; index += 1) {
    context.lineWidth = (widths[index - 1] + widths[index]) / 2;
    context.beginPath();
    context.moveTo(points[index - 1].x, points[index - 1].y);
    context.lineTo(points[index].x, points[index].y);
    context.stroke();
  }
  context.restore();
}

export interface PressureWidthRange {
  pressureLow: number;
  pressureHigh: number;
  minMm: number;
  maxMm: number;
}

/** Copy mode's line: pencil-like, thinner than Tapers so detailed copies stay readable. */
export const COPY_WIDTH_RANGE: PressureWidthRange = { pressureLow: 0.03, pressureHigh: 0.5, minMm: 0.4, maxMm: 1.6 };
/** Width when the device reports no pressure. */
export const COPY_FALLBACK_WIDTH_MM = 0.8;

export function widthForPressureMm(pressure: number, range: PressureWidthRange): number {
  const amount = (Math.min(range.pressureHigh, Math.max(range.pressureLow, pressure)) - range.pressureLow) / (range.pressureHigh - range.pressureLow);
  return range.minMm + amount * (range.maxMm - range.minMm);
}

/**
 * Width per point in mm. The first and last samples carry placeholder
 * pressures (touch-down and lift), so they borrow their neighbour's width.
 */
export function pressureWidthsMm(pressures: ReadonlyArray<number | undefined>, range: PressureWidthRange, fallbackMm: number): number[] {
  const widths = pressures.map((pressure) => (pressure === undefined || !Number.isFinite(pressure) ? fallbackMm : widthForPressureMm(pressure, range)));
  if (widths.length >= 3) {
    widths[0] = widths[1];
    widths[widths.length - 1] = widths[widths.length - 2];
  }
  return widths;
}
