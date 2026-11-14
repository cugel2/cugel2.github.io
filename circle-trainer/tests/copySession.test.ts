import { describe, expect, it } from "vitest";
import {
  addStroke, backToFrame, blink, canDraw, clearStrokes, fromFrameUnits, isOffFrame, newCopy, newSession, parseSession,
  setCompare, setView, startStroke, toFrameUnits, undoStroke,
} from "../src/copy/copySession";

const view = { x: 0.1, y: 0.2, w: 0.6 };
const stroke = (x: number) => ({ points: [{ x, y: 0.1, p: 0.3 }, { x: x + 0.1, y: 0.2, p: 0.4 }] });

describe("copySession", () => {
  it("locks the framing at the first stroke only", () => {
    let session = newSession("book", 0.8, view, 0);
    expect(session.lockedView).toBeNull();
    session = addStroke(startStroke(session)!, stroke(0.1), 1);
    expect(session.lockedView).toEqual(view);
    session = setView(session, { x: 0.3, y: 0.4, w: 0.2 });
    expect(isOffFrame(session)).toBe(true);
    session = addStroke(startStroke(session)!, stroke(0.2), 2);
    expect(session.lockedView).toEqual(view);
    session = backToFrame(session);
    expect(session.view).toEqual(view);
    expect(isOffFrame(session)).toBe(false);
  });

  it("undoes and clears strokes; with none left the framing is released", () => {
    let session = newSession("book", 0.8, view, 0);
    for (const x of [0.1, 0.2, 0.3]) session = addStroke(startStroke(session)!, stroke(x));
    session = undoStroke(session);
    expect(session.strokes.map((s) => s.points[0].x)).toEqual([0.1, 0.2]);
    expect(session.lockedView).toEqual(view);
    session = clearStrokes(setCompare(session, "BOTH"));
    expect(session.strokes).toEqual([]);
    expect(session.lockedView).toBeNull();
    expect(session.compare).toBeNull();
    expect(undoStroke(session)).toBe(session);
  });

  it("undoing the last stroke releases the framing, so a new one can be locked", () => {
    let session = addStroke(startStroke(newSession("book", 0.8, view, 0))!, stroke(0.1));
    session = undoStroke(setView(session, { x: 0.4, y: 0.4, w: 0.1 }));
    expect(session.lockedView).toBeNull();
    session = startStroke(session)!;
    expect(session.lockedView).toEqual({ x: 0.4, y: 0.4, w: 0.1 });
  });

  it("refuses drawing while comparing, and compare needs a framing", () => {
    let session = newSession("book", 0.8, view, 0);
    expect(setCompare(session, "BOTH").compare).toBeNull();
    session = addStroke(startStroke(session)!, stroke(0.1));
    for (const mode of ["MINE", "BOTH", "REFERENCE"] as const) {
      const comparing = setCompare(session, mode);
      expect(canDraw(comparing)).toBe(false);
      expect(startStroke(comparing)).toBeNull();
    }
    expect(canDraw(setCompare(setCompare(session, "BOTH"), null))).toBe(true);
  });

  it("blinks between mine and the reference", () => {
    let session = addStroke(startStroke(newSession("book", 0.8, view, 0))!, stroke(0.1));
    session = setCompare(session, "MINE");
    expect(blink(session).compare).toBe("REFERENCE");
    expect(blink(blink(session)).compare).toBe("MINE");
    expect(blink(setCompare(session, "BOTH")).compare).toBe("BOTH");
  });

  it("a new copy drops strokes and framing but keeps the view", () => {
    let session = addStroke(startStroke(newSession("book", 0.8, view, 0))!, stroke(0.1));
    session = { ...session, tint: false };
    const fresh = newCopy(session, 1.2);
    expect(fresh.strokes).toEqual([]);
    expect(fresh.lockedView).toBeNull();
    expect(fresh.view).toEqual(view);
    expect(fresh.frameAspect).toBe(1.2);
    expect(fresh.tint).toBe(false);
  });

  it("stroke positions survive a resize", () => {
    const point = toFrameUnits(120, 90, 400, 0.25);
    const atNewSize = fromFrameUnits(point, 600);
    expect(atNewSize.x).toBeCloseTo(180);
    expect(atNewSize.y).toBeCloseTo(135);
    expect(point.p).toBe(0.25);
  });

  it("round-trips through storage and rejects junk", () => {
    const session = addStroke(startStroke(newSession("book", 0.8, view, 0))!, stroke(0.1), 5);
    expect(parseSession(JSON.parse(JSON.stringify(session)))).toEqual(session);
    expect(parseSession(null)).toBeNull();
    expect(parseSession({ version: 2 })).toBeNull();
    expect(parseSession({ ...session, frameAspect: -1 })).toBeNull();
  });
});
