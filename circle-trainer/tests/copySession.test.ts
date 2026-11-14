import { describe, expect, it } from "vitest";
import {
  addStroke, backToFrame, blink, canDraw, clearStrokes, fromFrameUnits, isOffFrame, memoryPhase, newCopy, newSession, parseSession,
  peek, PEEK_MS, referenceCovered, referenceMovable, setCompare, setMemorySeconds, setView, startMemory, startStroke,
  studyRemainingMs, toFrameUnits, undoStroke,
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

  it("draw from memory: study, then hidden, with counted peeks", () => {
    let session = setMemorySeconds(newSession("book", 0.8, view, 0), 30);
    expect(memoryPhase(session, 0)).toBe("READY");
    expect(startStroke(session, 0)).toBeNull();
    session = startMemory(session, 1000);
    expect(session.lockedView).toEqual(view);
    expect(memoryPhase(session, 1000)).toBe("STUDY");
    expect(studyRemainingMs(session, 11_000)).toBe(20_000);
    expect(canDraw(session, 30_999)).toBe(false);
    expect(referenceMovable(session)).toBe(false);
    expect(memoryPhase(session, 31_000)).toBe("HIDDEN");
    expect(referenceCovered(session, 31_000)).toBe(true);
    expect(canDraw(session, 31_000)).toBe(true);
    // Peeking during study does nothing; once hidden it shows the reference briefly and counts.
    expect(peek(session, 5000)).toBe(session);
    session = peek(session, 40_000);
    expect(session.peeks).toBe(1);
    expect(memoryPhase(session, 40_000 + PEEK_MS - 1)).toBe("PEEK");
    expect(referenceCovered(session, 40_001)).toBe(false);
    expect(memoryPhase(session, 40_000 + PEEK_MS)).toBe("HIDDEN");
    session = peek(session, 50_000);
    expect(session.peeks).toBe(2);
  });

  it("compare reveals a hidden reference; changing the setting or a new copy starts over", () => {
    let session = startMemory(setMemorySeconds(newSession("book", 0.8, view, 0), 15), 0);
    session = addStroke(startStroke(session, 20_000)!, stroke(0.1));
    expect(referenceCovered(setCompare(session, "BOTH"), 20_000)).toBe(false);
    expect(referenceMovable(setCompare(session, "BOTH"))).toBe(true);
    const restarted = setMemorySeconds(session, 60);
    expect(memoryPhase(restarted, 99_000)).toBe("READY");
    const fresh = newCopy(peek(session, 20_000), 1);
    expect(fresh.memorySeconds).toBe(15);
    expect(fresh.memoryStartedAt).toBeNull();
    expect(fresh.peeks).toBe(0);
    expect(setMemorySeconds(session, 7).memorySeconds).toBe(0);
  });

  it("reads sessions saved before draw from memory existed", () => {
    const { memorySeconds: _a, memoryStartedAt: _b, peekUntil: _c, peeks: _d, ...old } = newSession("book", 0.8, view, 0);
    const parsed = parseSession(old)!;
    expect(parsed.memorySeconds).toBe(0);
    expect(memoryPhase(parsed)).toBe("OFF");
  });
});
