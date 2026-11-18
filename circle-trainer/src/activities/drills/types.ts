import type { AnalysisResult, ExerciseType, Handedness, Point2, PrimitiveMetrics, RawStroke, TargetDefinition, TrialRecord } from "../../core/types";

/**
 * A drill is everything the trial runner needs to serve one kind of rep. The runner (the trial state machine in
 * main.ts) names no drill: it reaches everything drill-specific through the registry.
 *
 * Rules the runner applies the same way to every drill, so they are not part of the contract:
 * - A drill needing one stroke is scored when it lifts; its record holds `rawStroke`. A drill needing more
 *   (strokesRequired > 1) shows "n/N" progress, keeps drawing after an interrupted or rejected stroke, and is
 *   scored when the last one is accepted; its record holds `rawStrokes`.
 * - The record's `correctionGateEnabled` is the setting when `usesCorrectionGate`, otherwise false.
 */
export interface Drill<T extends TargetDefinition = TargetDefinition> {
  /** Stored value (trial records, ticks, the queue, the saved mode). Never changes. */
  id: ExerciseType;
  /** Plural name: the menu, the Today ticks, trophy cards. "Boxes". */
  label: string;
  /** In running text: "Next box", "Committed s curve ✓", "Box · 4/11" (capitalised). */
  singular: string;
  /** The trophy detail title: "Best S curve". */
  trophyNoun: string;
  versions: { metric: string; scoring: string };
  /** Reps when ticked for Today, and rough seconds per rep for the "about N min" estimate. */
  today: { count: number; secondsPerRep: number };
  /** The intro card shown before the first rep of a session. `compact` uses the smaller card. */
  intro: { kicker: string; prompt: string; note?: string; compact: boolean };
  /** What the blue reveal shows: "Feedback shown — ideal path in blue". */
  revealName: string;
  strokesRequired: number;
  usesCorrectionGate: boolean;
  /** Extra toolbar buttons while drawing: Undo (removes the last accepted stroke) and Tips. */
  controls: { undo: boolean; tips: boolean };

  generate(canvas: CanvasSize, cssPxPerMm: number, sessionSeed: string, index: number, handedness: Handedness): T;
  /** A stroke that should not count (with the toast to show), or null to accept it. Multi-stroke drills only. */
  acceptStroke?(stroke: RawStroke, cssPxPerMm: number): string | null;
  /**
   * The same target laid out for a new canvas size, and how far accepted strokes must move to stay on it, or null
   * if it does not fit. A drill with this is laid out per canvas and drawing hand: it is moved on resize, and a
   * hand change applies from its next target.
   */
  relayout?(target: T, canvas: CanvasSize, cssPxPerMm: number, handedness: Handedness): { target: T; strokeShift: Point2 } | null;
  analyse(target: T, strokes: readonly RawStroke[], context: { cssPxPerMm: number; correctionGateEnabled: boolean }): AnalysisResult;

  /** Draws the whole trial: cue, strokes and (in feedback) the reveal, in this drill's order. */
  draw(g: CanvasRenderingContext2D, scene: DrillScene<T>): void;
  /** The measurements line on the feedback card. */
  feedbackText(metrics: PrimitiveMetrics): string;
  /** The measurements line in the trophy detail. */
  trophyText(metrics: PrimitiveMetrics): string;
  /** What a trophy thumbnail shows, in the trial's own canvas coordinates. */
  trophyMarks(trial: TrialRecord, cssPxPerMm: number): Mark[];
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface DrillScene<T> {
  target: T;
  /** Accepted strokes of this trial (the finished one, for a one-stroke drill). */
  strokes: readonly RawStroke[];
  /** The stroke being drawn, if any. */
  activeStroke: RawStroke | null;
  feedback: boolean;
  cssPxPerMm: number;
  /** The canvas size the target was laid out for. */
  layoutCanvas: CanvasSize;
}

/** One element of a trophy drawing. */
export interface Mark {
  points: Point2[];
  color: string;
  width: number;
  dash?: number[];
  /** Draw a small arrowhead at the last point and a dot at the first. */
  arrow?: boolean;
  /** Fill the closed polygon with `color` instead of stroking it. */
  fill?: boolean;
  /** Per-point stroke widths in the trial's CSS px; these scale with the drawing (a physical width), unlike `width`. */
  widths?: Array<number | null>;
}
