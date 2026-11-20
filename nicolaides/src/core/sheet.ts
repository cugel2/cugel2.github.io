/**
 * A sheet is one page of drawing: several gestures, or one long study carried
 * across days. Its shape is fixed when it is made, and strokes are stored in
 * sheet widths, so the drawing keeps its registration through rotations.
 *
 * Every Pencil sample is kept (position, pressure, tilt, timing) so the sheet
 * can be drawn again with a different brush later. Samples are packed into an
 * Int16Array, six numbers per point:
 *   x, y        sheet widths × POS_SCALE
 *   pressure    0–1 × 10000
 *   altitude    radians × 10000 (Pencil tilt from the screen, π/2 upright)
 *   azimuth     radians × 5000
 *   dt          ms since the stroke began (capped)
 */
import type { FrameRef } from "./poses";

export const POS_SCALE = 16000;
export const FIELDS = 6;

export interface Sample {
  x: number;
  y: number;
  pressure?: number;
  altitude?: number;
  azimuth?: number;
  t: number;
}

export interface Sheet {
  id: string;
  /** Book day it was begun on, e.g. "S1-0-A". */
  day: string;
  occ: number;
  dayIndex: number;
  step: number;
  ex: number[];
  /** Carried-on artwork id (the five-hour contour etc.). */
  group?: string;
  /** Height over width. */
  aspect: number;
  /** Width in CSS px it was drawn at, so brushes keep their size on replay (Stage 1+). */
  widthPx?: number;
  /** Medium id (src/core/brushes.ts); older sheets take theirs from the exercise. */
  medium?: string;
  created: number;
  updated: number;
  strokes: Int16Array[];
  /** References shown while it was drawn, in order. */
  poses: FrameRef[];
  source: "muybridge" | "life" | "own";
}

const clampInt16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));

export function packStroke(samples: readonly Sample[]): Int16Array {
  const out = new Int16Array(samples.length * FIELDS);
  const t0 = samples[0]?.t ?? 0;
  samples.forEach((s, i) => {
    const o = i * FIELDS;
    out[o] = clampInt16(s.x * POS_SCALE);
    out[o + 1] = clampInt16(s.y * POS_SCALE);
    out[o + 2] = clampInt16((s.pressure ?? -0.0001) * 10000);
    out[o + 3] = clampInt16((s.altitude ?? Math.PI / 2) * 10000);
    out[o + 4] = clampInt16((s.azimuth ?? 0) * 5000);
    out[o + 5] = clampInt16(s.t - t0);
  });
  return out;
}

export function unpackStroke(data: Int16Array): Sample[] {
  const out: Sample[] = [];
  for (let o = 0; o + FIELDS <= data.length; o += FIELDS) {
    out.push({
      x: data[o] / POS_SCALE,
      y: data[o + 1] / POS_SCALE,
      pressure: data[o + 2] < 0 ? undefined : data[o + 2] / 10000,
      altitude: data[o + 3] / 10000,
      azimuth: data[o + 4] / 5000,
      t: data[o + 5],
    });
  }
  return out;
}

/** Line width as a share of the sheet's width: a soft pencil, about 0.3–1.4 mm on an iPad-sized sheet. */
const WIDTH_MIN = 0.0016;
const WIDTH_MAX = 0.0068;
const WIDTH_NO_PRESSURE = 0.0032;
const PRESSURE_LOW = 0.03;
const PRESSURE_HIGH = 0.6;

export function widthFor(pressure: number | undefined): number {
  if (pressure === undefined || !Number.isFinite(pressure)) return WIDTH_NO_PRESSURE;
  const amount = (Math.min(PRESSURE_HIGH, Math.max(PRESSURE_LOW, pressure)) - PRESSURE_LOW) / (PRESSURE_HIGH - PRESSURE_LOW);
  return WIDTH_MIN + amount * (WIDTH_MAX - WIDTH_MIN);
}

export type StrokeContext = Pick<CanvasRenderingContext2D, "save" | "restore" | "beginPath" | "arc" | "fill" | "moveTo" | "lineTo" | "stroke" | "strokeStyle" | "fillStyle" | "lineCap" | "lineWidth">;

/**
 * Draws samples (in sheet widths) at `scale` px per sheet width, offset by (ox, oy).
 * Safari gives the first and last samples placeholder pressures, so they take their
 * neighbour's width, as in Circle Trainer.
 */
export function drawSamples(ctx: StrokeContext, samples: readonly Sample[], scale: number, ox = 0, oy = 0, colour = "#1c1a17"): void {
  if (samples.length === 0) return;
  const widths = samples.map((s) => widthFor(s.pressure) * scale);
  if (widths.length >= 3) { widths[0] = widths[1]; widths[widths.length - 1] = widths[widths.length - 2]; }
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(ox + samples[0].x * scale, oy + samples[0].y * scale, widths[0] / 2, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 1; i < samples.length; i += 1) {
    ctx.lineWidth = (widths[i - 1] + widths[i]) / 2;
    ctx.beginPath();
    ctx.moveTo(ox + samples[i - 1].x * scale, oy + samples[i - 1].y * scale);
    ctx.lineTo(ox + samples[i].x * scale, oy + samples[i].y * scale);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawSheet(ctx: StrokeContext, sheet: Pick<Sheet, "strokes">, scale: number, ox = 0, oy = 0): void {
  for (const stroke of sheet.strokes) drawSamples(ctx, unpackStroke(stroke), scale, ox, oy);
}

/** The largest rectangle of `aspect` (height/width) centred in a w×h box, with a margin. */
export function fitSheet(aspect: number, w: number, h: number, margin = 12): { left: number; top: number; width: number; height: number } {
  const aw = Math.max(1, w - margin * 2);
  const ah = Math.max(1, h - margin * 2);
  const width = Math.min(aw, ah / aspect);
  const height = width * aspect;
  return { left: (w - width) / 2, top: (h - height) / 2, width, height };
}

export function createId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
