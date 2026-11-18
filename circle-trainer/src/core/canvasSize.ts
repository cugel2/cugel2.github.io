import { boxTargetRejection, buildBoxTarget } from "./box";
import { sampleTargetPathCss } from "./targets";
import type { BoxTarget, Handedness, Point2, RawStroke, TargetDefinition } from "./types";

/**
 * The drawing canvas is drawn in CSS px (scaled by the device pixel ratio) and Pencil positions are measured in
 * CSS px from its on-screen box. If the box changes size while the canvas keeps its old pixel size, the browser
 * stretches the old picture to fit, so marks land away from the Pencil tip, more so further from the top left.
 * The Home Screen app corrects its height late after a rotation or a return to the app, so this has to be
 * checked whenever the canvas's box changes, not only on window resize.
 */
export interface CanvasBox {
  width: number;
  height: number;
}

/** The pixel size the canvas should have for its on-screen box. */
export function backingSize(box: CanvasBox, devicePixelRatio: number): CanvasBox {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { width: Math.max(1, Math.round(box.width * ratio)), height: Math.max(1, Math.round(box.height * ratio)) };
}

/** True when the canvas's pixel size no longer matches its on-screen box (a hidden, zero-size canvas never does). */
export function backingOutOfDate(box: CanvasBox, backing: CanvasBox, devicePixelRatio: number): boolean {
  if (box.width <= 0 || box.height <= 0) return false;
  const wanted = backingSize(box, devicePixelRatio);
  return wanted.width !== backing.width || wanted.height !== backing.height;
}

/**
 * Whether every part of a target is still on a canvas of this size (with a small margin for the checkpoint
 * circles). For a box this checks the reference box and the answer box.
 */
export function targetOnCanvas(target: TargetDefinition, box: CanvasBox, cssPxPerMm: number, marginCss = 8): boolean {
  const points: Point2[] = target.kind === "BOX"
    ? [...target.referenceCornersCss, ...target.answerCornersCss]
    : sampleTargetPathCss(target, cssPxPerMm, 160);
  return points.every((point) => point.x >= marginCss && point.x <= box.width - marginCss && point.y >= marginCss && point.y <= box.height - marginCss);
}

export type ResizeAction =
  /** Keep everything and redraw it at the new size. */
  | "REDRAW"
  /** A stroke is being drawn or scored: decide again once it is done. */
  | "WAIT"
  /** Put the same box (and any edges drawn) into the halves of the new canvas: relayoutBox. */
  | "RELAYOUT_BOX"
  /** Nothing is drawn yet and the target no longer fits the canvas: make a new one. */
  | "NEW_TARGET";

export interface ResizeSituation {
  state: "PREPARING" | "READY" | "DRAWING" | "PROCESSING" | "FEEDBACK";
  target: TargetDefinition | null;
  /** The canvas size the target was laid out for. */
  generatedFor: CanvasBox | null;
  canvas: CanvasBox;
  cssPxPerMm: number;
}

/** Sizes within a pixel count as the same (sub-pixel layout noise). */
const sameSize = (a: CanvasBox, b: CanvasBox) => Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;

/**
 * What to do when the drawing canvas changes size (a rotation, or the Home Screen app's late height correction).
 * Call it once the size has settled: on the iPad a rotation arrives in steps.
 *
 * A box is laid out for the exact canvas it was made for (its two halves are cut from that size, side by side in
 * landscape and stacked in portrait), so whenever the size changes the same box is moved into the new halves,
 * with any edges already drawn, at any point of the trial. Other targets are kept while they fit; one that no
 * longer fits is replaced only before it is drawn. A stroke being drawn or scored is never disturbed.
 */
export function actionAfterResize(situation: ResizeSituation): ResizeAction {
  const { state, target, canvas } = situation;
  if (!target || state === "PREPARING") return "REDRAW";
  if (state === "DRAWING" || state === "PROCESSING") return "WAIT";
  if (target.kind === "BOX") return situation.generatedFor && sameSize(situation.generatedFor, canvas) ? "REDRAW" : "RELAYOUT_BOX";
  if (state === "FEEDBACK") return "REDRAW";
  return targetOnCanvas(target, canvas, situation.cssPxPerMm) ? "REDRAW" : "NEW_TARGET";
}

/**
 * The same box placed in the halves of a new canvas, and how far its drawing half moved. Placement only shifts
 * each half (the box's size and shape do not depend on the canvas), so edges moved by `answerShiftCss` keep
 * exactly their position on the box and score exactly the same. Null if the box does not fit the new canvas.
 */
export function relayoutBox(
  target: BoxTarget,
  canvas: CanvasBox,
  cssPxPerMm: number,
  handedness: Handedness,
): { target: BoxTarget; answerShiftCss: Point2 } | null {
  const moved = buildBoxTarget(target, canvas, cssPxPerMm, handedness);
  if (boxTargetRejection(moved, canvas, cssPxPerMm, handedness) !== null) return null;
  return {
    target: moved,
    answerShiftCss: { x: moved.answerOffsetCss.x - target.answerOffsetCss.x, y: moved.answerOffsetCss.y - target.answerOffsetCss.y },
  };
}

/** A stroke moved on the canvas (its samples' positions shifted; nothing else changes). */
export function shiftStroke(stroke: RawStroke, shift: Point2): RawStroke {
  return { ...stroke, samples: stroke.samples.map((sample) => ({ ...sample, xCss: sample.xCss + shift.x, yCss: sample.yCss + shift.y })) };
}
