/**
 * Tap test for "tap anywhere for the next rep": during feedback, a short touch on the
 * drawing canvas that barely moves starts the next rep. Anything longer or wider is a
 * stroke, which is ignored (never scored against the new target).
 */

/** Longest touch, pointerdown to pointerup, that still counts as a tap. */
export const TAP_MAX_DURATION_MS = 350;
/** Furthest the Pencil may stray from where it touched down, in mm. */
export const TAP_MAX_MOVEMENT_MM = 2;

export interface TapPoint {
  readonly xCss: number;
  readonly yCss: number;
  readonly tMs: number;
}

/**
 * True when the points (pointerdown first, pointerup last) form a tap: the touch lasted at
 * most `TAP_MAX_DURATION_MS` and no point lies more than `TAP_MAX_MOVEMENT_MM` from the first.
 */
export function isTap(points: readonly TapPoint[], cssPxPerMm: number): boolean {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || !(cssPxPerMm > 0)) return false;
  if (last.tMs - first.tMs > TAP_MAX_DURATION_MS) return false;
  const limitPx = TAP_MAX_MOVEMENT_MM * cssPxPerMm;
  return points.every((point) => Math.hypot(point.xCss - first.xCss, point.yCss - first.yCss) <= limitPx);
}
