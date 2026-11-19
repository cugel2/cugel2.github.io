import { describe, expect, it } from "vitest";
import {
  addStroke, again, asMemory, asPlainCopy, attemptNumber, canAgain, canDraw, clearStrokes, DEFAULT_STUDY_SECONDS, formatStudy, memoryPhase,
  newCopy, newSession, parseSession, peek, PEEK_MS, referenceCovered, seedMemory, setCompare, setStudySeconds, setView, startMemory,
  startStroke, STUDY_SECONDS, undoStroke, type CopySession,
} from "../src/copy/copySession";

const view = { x: 0.1, y: 0.2, w: 0.6 };
const stroke = (x: number) => ({ points: [{ x, y: 0.1, p: 0.3 }, { x: x + 0.1, y: 0.2, p: 0.4 }] });

/** A Memory session that has studied for `seconds` and drawn `count` strokes, hidden from t = seconds * 1000. */
function drawnAttempt(count = 2, seconds = 15): { session: CopySession; hiddenAt: number } {
  let session = startMemory(asMemory({ ...newSession("book", 0.8, view, 0), memorySeconds: seconds }), 0);
  const hiddenAt = seconds * 1000;
  for (let index = 0; index < count; index += 1) session = addStroke(startStroke(session, hiddenAt)!, stroke(index / 10), hiddenAt);
  return { session, hiddenAt };
}

describe("Memory mode", () => {
  it("offers 15 s, 30 s, 1, 2 and 5 min", () => {
    expect([...STUDY_SECONDS]).toEqual([15, 30, 60, 120, 300]);
    expect(STUDY_SECONDS.map(formatStudy)).toEqual(["15 s", "30 s", "1 min", "2 min", "5 min"]);
  });

  it("studies first: framing locked, drawing refused, then covered with no time limit", () => {
    let session = asMemory(newSession("book", 0.8, view, 0));
    expect(session.memorySeconds).toBe(DEFAULT_STUDY_SECONDS);
    expect(memoryPhase(session, 0)).toBe("READY");
    expect(canDraw(session, 0)).toBe(false);
    session = startMemory(session, 1000);
    expect(session.lockedView).toEqual(view);
    expect(canDraw(session, 1000 + 59_999)).toBe(false);
    expect(memoryPhase(session, 1000 + 60_000)).toBe("HIDDEN");
    expect(canDraw(session, 1000 + 60_000)).toBe(true);
    expect(referenceCovered(session, 10 * 3_600_000)).toBe(true);
  });

  it("counts peeks per attempt", () => {
    let { session, hiddenAt } = drawnAttempt();
    session = peek(session, hiddenAt);
    expect(memoryPhase(session, hiddenAt + PEEK_MS - 1)).toBe("PEEK");
    session = peek(session, hiddenAt + PEEK_MS);
    expect(session.peeks).toBe(2);
    session = again(setCompare(session, "BOTH"), hiddenAt + 10_000);
    expect(session.peeks).toBe(0);
    expect(session.attempts.map((attempt) => attempt.peeks)).toEqual([2]);
  });

  it("Again keeps the attempt, studies the same framing at once and draws afresh", () => {
    const { session: drawn, hiddenAt } = drawnAttempt(2);
    const moved = setView(setCompare(drawn, "BOTH"), { x: 0.5, y: 0.5, w: 0.2 });
    expect(canAgain(moved)).toBe(true);
    const next = again(moved, hiddenAt + 5000);
    expect(next.attempts).toHaveLength(1);
    expect(next.attempts[0].strokes).toEqual(drawn.strokes);
    expect(next.strokes).toEqual([]);
    expect(next.lockedView).toEqual(view);
    expect(next.view).toEqual(view);
    expect(next.compare).toBeNull();
    expect(memoryPhase(next, hiddenAt + 5000)).toBe("STUDY");
    expect(attemptNumber(next)).toBe(2);
    // A third attempt keeps both earlier ones, oldest first.
    const third = again(addStroke(startStroke(next, hiddenAt + 25_000)!, stroke(0.5)), hiddenAt + 30_000);
    expect(third.attempts.map((attempt) => attempt.strokes.length)).toEqual([2, 1]);
    expect(attemptNumber(third)).toBe(3);
  });

  it("Again needs strokes on a locked framing, in Memory only", () => {
    expect(canAgain(startMemory(asMemory(newSession("book", 0.8, view, 0)), 0))).toBe(false);
    const copy = addStroke(startStroke(newSession("book", 0.8, view, 0))!, stroke(0.1));
    expect(canAgain(copy)).toBe(false);
    expect(again(copy)).toBe(copy);
  });

  it("a later attempt emptied by Undo or Clear keeps the framing and its study", () => {
    const { session: drawn, hiddenAt } = drawnAttempt(1);
    let next = again(drawn, hiddenAt);
    next = addStroke(startStroke(next, hiddenAt + 20_000)!, stroke(0.3));
    for (const emptied of [undoStroke(next), clearStrokes(next)]) {
      expect(emptied.strokes).toEqual([]);
      expect(emptied.lockedView).toEqual(view);
      expect(emptied.memoryStartedAt).toBe(hiddenAt);
      expect(emptied.attempts).toHaveLength(1);
    }
    // The first attempt still releases as before: Start again.
    const first = undoStroke(drawn);
    expect(first.lockedView).toBeNull();
    expect(memoryPhase(first)).toBe("READY");
  });

  it("a new drawing drops the attempts but keeps the study time", () => {
    const { session } = drawnAttempt();
    const fresh = newCopy(again(session), 1.1);
    expect(fresh.attempts).toEqual([]);
    expect(fresh.memorySeconds).toBe(15);
    expect(fresh.lockedView).toBeNull();
  });

  it("changing the study time keeps a valid one only", () => {
    const session = asMemory(newSession("book", 0.8, view, 0));
    expect(setStudySeconds(session, 300).memorySeconds).toBe(300);
    expect(setStudySeconds(session, 0)).toBe(session);
    expect(setStudySeconds(session, 45)).toBe(session);
  });

  it("starts from Copy's book, place and old Memory setting; Copy's strokes stay with Copy", () => {
    let copy = addStroke(startStroke(newSession("book-1", 0.9, view, 0))!, stroke(0.1));
    copy = { ...copy, memorySeconds: 30, tint: false };
    copy = setView(copy, { x: 0.3, y: 0.3, w: 0.4 });
    const memory = seedMemory(copy, 5)!;
    expect(memory.bookId).toBe("book-1");
    expect(memory.view).toEqual({ x: 0.3, y: 0.3, w: 0.4 });
    expect(memory.strokes).toEqual([]);
    expect(memory.lockedView).toBeNull();
    expect(memory.memorySeconds).toBe(30);
    expect(memory.tint).toBe(false);
    expect(seedMemory({ ...copy, memorySeconds: 0 })!.memorySeconds).toBe(DEFAULT_STUDY_SECONDS);
    expect(seedMemory(null)).toBeNull();
    expect(seedMemory(newSession(null, 1, null))).toBeNull();
  });

  it("Copy opens a stored mid-memory copy as a plain copy, strokes and framing kept", () => {
    const { session } = drawnAttempt(2, 120);
    const plain = asPlainCopy(peek(session, 120_000));
    expect(plain.memorySeconds).toBe(0);
    expect(memoryPhase(plain)).toBe("OFF");
    expect(plain.strokes).toEqual(session.strokes);
    expect(plain.lockedView).toEqual(view);
    expect(plain.peeks).toBe(0);
    const already = newSession("book", 0.8, view, 0);
    expect(asPlainCopy(already)).toBe(already);
  });

  it("stores and reads back attempts and 5 min; older copies without them still open", () => {
    const { session, hiddenAt } = drawnAttempt(2, 300);
    const stored = JSON.parse(JSON.stringify({ ...again(peek(session, hiddenAt), hiddenAt + 1), showEarlier: false }));
    const parsed = parseSession(stored)!;
    expect(parsed.memorySeconds).toBe(300);
    expect(parsed.attempts).toHaveLength(1);
    expect(parsed.attempts[0]).toEqual({ strokes: session.strokes, peeks: 1 });
    expect(parsed.showEarlier).toBe(false);
    const { attempts: _a, showEarlier: _b, ...old } = newSession("book", 0.8, view, 0);
    const reopened = parseSession(old)!;
    expect(reopened.attempts).toEqual([]);
    expect(reopened.showEarlier).toBe(true);
    // Attempts without a framing make no sense and are dropped; malformed ones are skipped.
    expect(parseSession({ ...stored, lockedView: null })!.attempts).toEqual([]);
    expect(parseSession({ ...stored, attempts: [{ strokes: "x" }, ...stored.attempts] })!.attempts).toHaveLength(1);
  });
});
