/**
 * Turns touch pointers into pan and zoom steps. Each move compares the
 * fingers' centre and spread before and after, so one finger pans, two
 * fingers pan and pinch together, and a finger lifting mid-pinch carries on
 * as a one-finger pan from where the remaining finger is, with no jump.
 */
import type { Point } from "./docSpace";

export interface GestureStep {
  /** Centre of the fingers before this move (frame px). */
  from: Point;
  /** Centre after this move. */
  to: Point;
  /** Spread after / spread before; 1 for a one-finger pan. */
  ratio: number;
}

export class GestureTracker {
  private readonly points = new Map<number, Point>();

  get count(): number {
    return this.points.size;
  }

  down(id: number, point: Point): void {
    this.points.set(id, { ...point });
  }

  up(id: number): void {
    this.points.delete(id);
  }

  clear(): void {
    this.points.clear();
  }

  /** Returns the step this move makes, or null if the pointer is not tracked or nothing moved. */
  move(id: number, point: Point): GestureStep | null {
    const previous = this.points.get(id);
    if (!previous) return null;
    // Only the first two fingers steer; a third is tracked but ignored.
    const steering = [...this.points.keys()].slice(0, 2);
    const before = [...steering.map((key) => this.points.get(key)!)];
    this.points.set(id, { ...point });
    if (!steering.includes(id)) return null;
    const after = steering.map((key) => this.points.get(key)!);
    const from = centre(before);
    const to = centre(after);
    let ratio = 1;
    if (before.length === 2) {
      const spreadBefore = distance(before[0], before[1]);
      const spreadAfter = distance(after[0], after[1]);
      if (spreadBefore > 1 && spreadAfter > 1) ratio = spreadAfter / spreadBefore;
    }
    if (ratio === 1 && from.x === to.x && from.y === to.y) return null;
    return { from, to, ratio };
  }
}

function centre(points: readonly Point[]): Point {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
