import { describe, expect, it } from "vitest";
import { clampView, docToFrame, fitPage, frameToDoc, layoutPages, MIN_VIEW_WIDTH, moveView, PAGE_GAP, visiblePages, zoomAbout } from "../src/copy/docSpace";

const frame = { width: 400, height: 500 };
const layout = layoutPages([{ width: 800, height: 1200 }, { width: 600, height: 600 }, { width: 1000, height: 1500 }]);

describe("docSpace", () => {
  it("stacks pages at a common width with gaps", () => {
    expect(layout.heights).toEqual([1.5, 1, 1.5]);
    expect(layout.tops[1]).toBeCloseTo(1.5 + PAGE_GAP);
    expect(layout.height).toBeCloseTo(4 + 2 * PAGE_GAP);
  });

  it("maps frame to document and back", () => {
    const view = { x: 0.2, y: 0.7, w: 0.5 };
    const point = { x: 123, y: 321 };
    const back = docToFrame(view, frame, frameToDoc(view, frame, point));
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it("zooming about a point keeps that point fixed", () => {
    const view = { x: 0.1, y: 0.2, w: 0.8 };
    const at = { x: 300, y: 120 };
    const before = frameToDoc(view, frame, at);
    const zoomed = zoomAbout(view, layout, frame, at, 2.5);
    expect(zoomed.w).toBeCloseTo(0.32);
    const after = frameToDoc(zoomed, frame, at);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("moving the view keeps the grabbed point under the finger", () => {
    const view = { x: 0.1, y: 0.2, w: 0.8 };
    const grabbed = frameToDoc(view, frame, { x: 100, y: 100 });
    const moved = moveView(view, layout, frame, { x: 100, y: 100 }, { x: 140, y: 60 }, 1.5);
    const under = frameToDoc(moved, frame, { x: 140, y: 60 });
    expect(under.x).toBeCloseTo(grabbed.x);
    expect(under.y).toBeCloseTo(grabbed.y);
  });

  it("clamps zoom and keeps the frame centre on the document", () => {
    expect(clampView({ x: 0, y: 0, w: 0.001 }, layout, frame).w).toBe(MIN_VIEW_WIDTH);
    const far = clampView({ x: 5, y: -9, w: 0.5 }, layout, frame);
    expect(far.x + far.w / 2).toBeCloseTo(1);
    expect(far.y + (far.w * frame.height / frame.width) / 2).toBeCloseTo(0);
  });

  it("fits a whole page in the frame", () => {
    const view = fitPage(layout, frame, 0);
    // Page 0 is 1 × 1.5; the frame is 0.8 as tall as wide, so height decides.
    expect(view.w * frame.height / frame.width).toBeCloseTo(1.5);
    expect(view.y).toBeCloseTo(0);
  });

  it("finds the pages the view crosses", () => {
    expect(visiblePages(layout, { x: 0, y: 0, w: 1 }, frame)).toEqual([0]);
    expect(visiblePages(layout, { x: 0, y: 1.2, w: 1 }, frame)).toEqual([0, 1]);
    expect(visiblePages(layout, { x: 0, y: 2.6, w: 0.4 }, frame, 1)).toEqual([1, 2]);
  });
});
