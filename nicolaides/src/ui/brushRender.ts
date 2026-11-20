/**
 * p5.brush drawing for sheets. p5.brush draws into one WebGL canvas at a time
 * (its "target"): the drawing pane's canvas while drawing, and short-lived
 * offscreen canvases for the gallery and Save to Photos, after which the
 * pane's canvas is made active again.
 */
// @ts-expect-error p5.brush ships without type declarations.
import * as brush from "p5.brush/standalone";
import { BRUSH_SCALE, brushPressure, type Medium, mediumById, mediumFor } from "../core/brushes";
import type { Sample, Sheet } from "../core/sheet";
import { unpackStroke } from "../core/sheet";
import { replayStroke, strokeSeed } from "../core/strokePieces";

/** Sheets made before Stage 1 did not record their width. */
export const DEFAULT_SHEET_WIDTH = 560;

let scaled = false;
let live: HTMLCanvasElement | null = null;

function ensureScaled(): void {
  if (scaled) return;
  brush.scaleBrushes(BRUSH_SCALE);
  scaled = true;
}

/** Makes a WebGL canvas `width` × `height` CSS px and makes it p5.brush's target. */
export function createTarget(width: number, height: number, density: number, parent: HTMLElement | null): HTMLCanvasElement {
  const canvas: HTMLCanvasElement = brush.createCanvas(width, height, { pixelDensity: density, parent, id: "" });
  ensureScaled();
  return canvas;
}

export function setLive(canvas: HTMLCanvasElement | null): void {
  live = canvas;
  if (canvas) brush.load(canvas);
}

/** Frees a canvas's WebGL context (browsers allow only a few at once). */
export function dispose(canvas: HTMLCanvasElement): void {
  try {
    const gl = canvas.getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch { /* already gone */ }
  canvas.remove();
}

export function clearTo(colour: string): void {
  brush.clear(colour);
  brush.render();
}

export function sheetMedium(sheet: Pick<Sheet, "ex" | "medium">): Medium {
  return mediumById(sheet.medium) ?? mediumFor({ ex: sheet.ex, media: [] });
}

/** A piece drawer for the active target: points in sheet widths on a sheet `width` × `height` px. */
export function pieceDrawer(medium: Medium, width: number, height: number) {
  return (points: readonly Sample[], seed: number) => {
    brush.seed(seed);
    brush.noiseSeed(seed);
    brush.set(medium.brush, medium.colour, medium.weight);
    brush.noFill();
    brush.spline(points.map((p) => [p.x * width - width / 2, p.y * width - height / 2, brushPressure(medium.kind, p.pressure)]), 0.5);
  };
}

/** Draws every stroke of `sheet` onto the active target, cleared to its paper first. */
export function replaySheet(sheet: Sheet, width: number, height: number, upTo = sheet.strokes.length): void {
  const medium = sheetMedium(sheet);
  brush.clear(medium.paper);
  const draw = pieceDrawer(medium, width, height);
  for (let i = 0; i < upTo; i += 1) replayStroke(unpackStroke(sheet.strokes[i]), strokeSeed(sheet.id, i), draw);
  brush.render();
}

export function render(): void {
  brush.render();
}

/**
 * The sheet as a plain 2D canvas `outWidth` px wide, drawn with its brushes at
 * the size it was drawn (so marks keep their look) and the resolution asked for.
 */
export function renderSheetImage(sheet: Sheet, outWidth: number): HTMLCanvasElement {
  const width = sheet.widthPx ?? DEFAULT_SHEET_WIDTH;
  const height = width * sheet.aspect;
  const offscreen = createTarget(width, height, outWidth / width, null);
  try {
    replaySheet(sheet, width, height);
    const out = document.createElement("canvas");
    out.width = Math.round(outWidth);
    out.height = Math.round(outWidth * sheet.aspect);
    out.getContext("2d")!.drawImage(offscreen, 0, 0, out.width, out.height);
    return out;
  } finally {
    dispose(offscreen);
    if (live) brush.load(live);
  }
}
