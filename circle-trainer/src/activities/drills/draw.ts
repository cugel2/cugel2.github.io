import type { Point2, RawStroke, TrialRecord } from "../../core/types";
import type { Mark } from "./types";

/** Canvas helpers shared by the drills. Moved unchanged from main.ts (0.16.0). */

export const INK = "#171717";
export const IDEAL_BLUE = "#1557c0";

export function strokeSegment(g: CanvasRenderingContext2D, a: Point2, b: Point2): void {
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.stroke();
}

export function drawLandmark(g: CanvasRenderingContext2D, point: Point2): void {
  g.beginPath();
  g.arc(point.x, point.y, 6, 0, Math.PI * 2);
  g.fillStyle = "#fffefa";
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = "#171717";
  g.stroke();
}

export function drawRawStroke(g: CanvasRenderingContext2D, stroke: RawStroke): void {
  if (stroke.samples.length === 0) return;
  g.strokeStyle = "#171717";
  g.fillStyle = "#171717";
  g.lineWidth = 2.2;
  g.setLineDash([]);
  g.beginPath();
  g.arc(stroke.samples[0].xCss, stroke.samples[0].yCss, g.lineWidth / 2, 0, Math.PI * 2);
  g.fill();
  if (stroke.samples.length < 2) return;
  g.beginPath();
  g.moveTo(stroke.samples[0].xCss, stroke.samples[0].yCss);
  for (let index = 1; index < stroke.samples.length; index += 1) g.lineTo(stroke.samples[index].xCss, stroke.samples[index].yCss);
  g.stroke();
}

/** A dashed blue path (the ideal revealed after lift). */
export function drawDashedPath(g: CanvasRenderingContext2D, path: readonly Point2[], lineWidth: number, dash: number[]): void {
  g.save();
  g.beginPath();
  g.moveTo(path[0].x, path[0].y);
  for (let index = 1; index < path.length; index += 1) g.lineTo(path[index].x, path[index].y);
  g.strokeStyle = IDEAL_BLUE;
  g.lineWidth = lineWidth;
  g.setLineDash(dash);
  g.stroke();
  g.restore();
}

/** A trophy mark for a stroke as drawn. */
export function strokeMark(samples: ReadonlyArray<{ xCss: number; yCss: number }>): Mark {
  return { points: samples.map((sample) => ({ x: sample.xCss, y: sample.yCss })), color: INK, width: 1.6 };
}

/** The single stroke of a one-stroke trial (records of those drills always hold `rawStroke`). */
export function singleStroke(trial: TrialRecord): RawStroke {
  if (!("rawStroke" in trial)) throw new Error("Expected a single-stroke trial");
  return trial.rawStroke;
}
