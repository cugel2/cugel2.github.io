import { describe, expect, it } from "vitest";
import { GestureTracker } from "../src/copy/gestures";

describe("GestureTracker", () => {
  it("one finger pans", () => {
    const tracker = new GestureTracker();
    tracker.down(1, { x: 10, y: 10 });
    expect(tracker.move(1, { x: 30, y: 5 })).toEqual({ from: { x: 10, y: 10 }, to: { x: 30, y: 5 }, ratio: 1 });
    expect(tracker.move(1, { x: 30, y: 5 })).toBeNull();
  });

  it("two fingers pinch about their centre", () => {
    const tracker = new GestureTracker();
    tracker.down(1, { x: 0, y: 0 });
    tracker.down(2, { x: 100, y: 0 });
    const step = tracker.move(2, { x: 200, y: 0 })!;
    expect(step.ratio).toBeCloseTo(2);
    expect(step.from).toEqual({ x: 50, y: 0 });
    expect(step.to).toEqual({ x: 100, y: 0 });
  });

  it("a finger lifting mid-pinch continues as a pan without a jump", () => {
    const tracker = new GestureTracker();
    tracker.down(1, { x: 0, y: 0 });
    tracker.down(2, { x: 100, y: 0 });
    tracker.move(2, { x: 120, y: 0 });
    tracker.up(2);
    expect(tracker.count).toBe(1);
    const step = tracker.move(1, { x: 5, y: 7 })!;
    expect(step).toEqual({ from: { x: 0, y: 0 }, to: { x: 5, y: 7 }, ratio: 1 });
  });

  it("ignores pointers it never saw go down", () => {
    expect(new GestureTracker().move(9, { x: 1, y: 1 })).toBeNull();
  });
});
