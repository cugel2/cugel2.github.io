import { describe, expect, it } from "vitest";
import { actionAfterResize, backingOutOfDate, backingSize, relayoutBox, shiftStroke, targetOnCanvas, type ResizeSituation } from "../src/core/canvasSize";
import { BOX_EDGES, nonHingeEdgeIndices } from "../src/core/box";
import { analyseBoxStrokes } from "../src/core/boxMetrics";
import { generateTarget } from "../src/core/targets";
import type { BoxTarget, LineTarget, RawStroke } from "../src/core/types";

const PX = 5.2;
const LANDSCAPE = { width: 1180, height: 690 };
const PORTRAIT = { width: 820, height: 1050 };

describe("canvas pixel size", () => {
  it("is the box times the pixel ratio, rounded, at least 1", () => {
    expect(backingSize({ width: 1180.4, height: 690.6 }, 2)).toEqual({ width: 2361, height: 1381 });
    expect(backingSize({ width: 0, height: 0 }, 2)).toEqual({ width: 1, height: 1 });
    expect(backingSize({ width: 100, height: 50 }, 0)).toEqual({ width: 100, height: 50 });
  });

  it("is out of date when the box changed but the pixels did not (the Home Screen app's late height)", () => {
    expect(backingOutOfDate({ width: 1180, height: 690 }, { width: 2360, height: 1380 }, 2)).toBe(false);
    expect(backingOutOfDate({ width: 1180, height: 640 }, { width: 2360, height: 1380 }, 2)).toBe(true);
  });

  it("never asks to resize a hidden canvas", () => {
    expect(backingOutOfDate({ width: 0, height: 0 }, { width: 2360, height: 1380 }, 2)).toBe(false);
  });
});

describe("targets on a resized canvas", () => {
  const line = (x1: number, y1: number, x2: number, y2: number): LineTarget => ({ kind: "LINE", aCss: { x: x1, y: y1 }, bCss: { x: x2, y: y2 }, lengthMm: 50 });

  it("checks the whole path against the canvas", () => {
    expect(targetOnCanvas(line(100, 100, 700, 100), PORTRAIT, PX)).toBe(true);
    expect(targetOnCanvas(line(100, 100, 1000, 100), PORTRAIT, PX)).toBe(false);
    expect(targetOnCanvas(line(100, 100, 100, 1000), LANDSCAPE, PX)).toBe(false);
  });

  it("checks both boxes of a box target", () => {
    const box = generateTarget("BOX", LANDSCAPE, PX, "resize", 0, "LEFT");
    expect(targetOnCanvas(box, LANDSCAPE, PX)).toBe(true);
    expect(targetOnCanvas(box, { width: 400, height: 690 }, PX)).toBe(false);
  });
});

describe("what a resize does", () => {
  const fitsBoth = { kind: "LINE", aCss: { x: 200, y: 200 }, bCss: { x: 600, y: 300 }, lengthMm: 80 } as const;
  const landscapeOnly = { kind: "LINE", aCss: { x: 100, y: 200 }, bCss: { x: 1050, y: 300 }, lengthMm: 180 } as const;
  const situation = (overrides: Partial<ResizeSituation>): ResizeSituation => ({
    state: "READY", target: fitsBoth, generatedFor: LANDSCAPE, canvas: PORTRAIT, cssPxPerMm: PX, ...overrides,
  });

  it("keeps a target that still fits, so a rotation does not make it jump", () => {
    expect(actionAfterResize(situation({}))).toBe("REDRAW");
  });

  it("makes a new target before anything is drawn when the old one no longer fits", () => {
    expect(actionAfterResize(situation({ target: landscapeOnly }))).toBe("NEW_TARGET");
  });

  it("waits while a stroke is being drawn or scored", () => {
    expect(actionAfterResize(situation({ state: "DRAWING", target: landscapeOnly }))).toBe("WAIT");
    expect(actionAfterResize(situation({ state: "PROCESSING" }))).toBe("WAIT");
  });

  it("keeps the feedback card", () => {
    expect(actionAfterResize(situation({ state: "FEEDBACK", target: landscapeOnly }))).toBe("REDRAW");
  });

  it("moves a box into the new halves whenever the size changes, started or not", () => {
    const box = generateTarget("BOX", LANDSCAPE, PX, "resize", 0, "LEFT");
    expect(actionAfterResize(situation({ target: box, canvas: { width: 1180.4, height: 690.5 } }))).toBe("REDRAW");
    expect(actionAfterResize(situation({ target: box, canvas: { width: 1180, height: 640 } }))).toBe("RELAYOUT_BOX");
    expect(actionAfterResize(situation({ target: box }))).toBe("RELAYOUT_BOX");
    expect(actionAfterResize(situation({ target: box, state: "FEEDBACK" }))).toBe("RELAYOUT_BOX");
  });

  it("does nothing special without a target or while preparing", () => {
    expect(actionAfterResize(situation({ target: null }))).toBe("REDRAW");
    expect(actionAfterResize(situation({ state: "PREPARING", target: landscapeOnly }))).toBe("REDRAW");
  });
});

describe("re-placing a box after a rotation", () => {
  // A landscape box that also fits the portrait halves (only some do: each box is made to fit the screen it was
  // made on, and the portrait halves are smaller).
  const box = Array.from({ length: 40 }, (_, index) => generateTarget("BOX", LANDSCAPE, PX, "relayout", index, "LEFT") as BoxTarget)
    .find((candidate) => relayoutBox(candidate, PORTRAIT, PX, "LEFT") !== null)!;
  const tooBigForPortrait = Array.from({ length: 40 }, (_, index) => generateTarget("BOX", LANDSCAPE, PX, "relayout", index, "LEFT") as BoxTarget)
    .find((candidate) => relayoutBox(candidate, PORTRAIT, PX, "LEFT") === null)!;
  const edgeStrokes = (target: BoxTarget): RawStroke[] => nonHingeEdgeIndices(target.hingeEdgeIndex).map((edge, index) => {
    const [a, b] = BOX_EDGES[edge];
    const start = target.answerCornersCss[a];
    const end = target.answerCornersCss[b];
    // A slightly wrong edge, so the score is not simply 100.
    const samples = Array.from({ length: 12 }, (_, step) => ({
      xCss: start.x + (end.x - start.x) * (step / 11) + 4 * Math.sin(index + step),
      yCss: start.y + (end.y - start.y) * (step / 11) + 3,
      tMs: index * 1000 + step * 8,
      sourceEventType: "pointermove" as const,
    }));
    return { id: `edge-${index}`, pointerType: "pen", startedAtEpochMs: index * 1000, cancelled: false, samples };
  });

  it("keeps the same box (pose, hinge, swing), each half moved into its new area", () => {
    const moved = relayoutBox(box, PORTRAIT, PX, "LEFT")!;
    expect(moved).not.toBeNull();
    for (const key of ["dimensionsMm", "referenceRotation", "hingeEdgeIndex", "swingDeg", "cameraDistanceFactor"] as const) {
      expect(moved.target[key]).toEqual(box[key]);
    }
    expect(targetOnCanvas(moved.target, PORTRAIT, PX)).toBe(true);
    moved.target.answerCornersCss.forEach((corner, index) => {
      expect(corner.x).toBeCloseTo(box.answerCornersCss[index].x + moved.answerShiftCss.x, 9);
      expect(corner.y).toBeCloseTo(box.answerCornersCss[index].y + moved.answerShiftCss.y, 9);
    });
  });

  it("edges moved with the drawing half score exactly as before", () => {
    const strokes = edgeStrokes(box);
    const before = analyseBoxStrokes(strokes, box, PX);
    const there = relayoutBox(box, PORTRAIT, PX, "LEFT")!;
    const after = analyseBoxStrokes(strokes.map((stroke) => shiftStroke(stroke, there.answerShiftCss)), there.target, PX);
    expect(after.accuracyScore).toBe(before.accuracyScore);
    expect(after.metrics.normalizedError).toBeCloseTo(before.metrics.normalizedError, 9);
    expect(after.metrics.fittedSwingDeg).toBeCloseTo(before.metrics.fittedSwingDeg, 6);
    // And back again lands where it started.
    const back = relayoutBox(there.target, LANDSCAPE, PX, "LEFT")!;
    back.target.answerCornersCss.forEach((corner, index) => expect(corner.x).toBeCloseTo(box.answerCornersCss[index].x, 9));
  });

  it("gives up when the box does not fit the new halves", () => {
    expect(relayoutBox(box, { width: 200, height: 200 }, PX, "LEFT")).toBeNull();
    expect(tooBigForPortrait).toBeDefined();
    expect(relayoutBox(tooBigForPortrait, PORTRAIT, PX, "LEFT")).toBeNull();
    expect(relayoutBox(tooBigForPortrait, LANDSCAPE, PX, "LEFT")).not.toBeNull();
  });

  it("shifts only a stroke's positions", () => {
    const [stroke] = edgeStrokes(box);
    const moved = shiftStroke(stroke, { x: 10, y: -5 });
    expect(moved.samples[3]).toEqual({ ...stroke.samples[3], xCss: stroke.samples[3].xCss + 10, yCss: stroke.samples[3].yCss - 5 });
    expect({ ...moved, samples: [] }).toEqual({ ...stroke, samples: [] });
  });
});
