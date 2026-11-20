/**
 * Brushes (p5.brush presets) and the medium each block is drawn in. Shared by
 * the app and the brush test page, so what you tried there is what you get.
 *
 * Two kinds of brush:
 * - "line" (pencils and pens): a light touch reaches the full line, as in Circle
 *   Trainer's Tapers. Weights are tuned to a measured width at a light touch.
 * - "layered" (charcoal, crayon, pastel, marker): p5.brush's own response, faint
 *   per pass, so strokes build up over several passes without going solid black.
 *
 * Weights are in CSS px with p5.brush's presets scaled by BRUSH_SCALE.
 */
import type { DrawStep } from "./course";

export const BRUSH_SCALE = 3;

export interface BrushSpec {
  name: string;
  label: string;
  weight: number;
  kind: "line" | "layered" | "wash";
  /** Width aimed at for a light touch, in mm. */
  mm?: number;
}

export const BRUSHES: BrushSpec[] = [
  { name: "2B", label: "Pencil 2B", weight: 2.3, kind: "line", mm: 0.8 },
  { name: "HB", label: "Pencil HB", weight: 1.2, kind: "line", mm: 0.5 },
  { name: "charcoal", label: "Charcoal", weight: 2.5, kind: "layered" },
  { name: "crayon", label: "Crayon", weight: 2.5, kind: "layered" },
  { name: "pastel", label: "Pastel / Conté", weight: 0.9, kind: "layered", mm: 5 },
  { name: "pen", label: "Pen (ink)", weight: 2.4, kind: "line", mm: 0.45 },
  { name: "rotring", label: "Technical pen", weight: 6.3, kind: "line", mm: 0.6 },
  { name: "marker", label: "Marker", weight: 2, kind: "layered" },
  { name: "wash", label: "Watercolour wash", weight: 1, kind: "wash" },
];

/** Line brushes: Pencil pressure 0.03–0.5 covers the brush's whole range; pressing harder adds nothing. */
const PRESSURE_LOW = 0.03;
const PRESSURE_HIGH = 0.5;
function linePressure(pressure: number): number {
  const amount = (Math.min(PRESSURE_HIGH, Math.max(PRESSURE_LOW, pressure)) - PRESSURE_LOW) / (PRESSURE_HIGH - PRESSURE_LOW);
  return 0.45 + amount * 0.75;
}

/** Layered brushes: the first version's gentle response, kept as it was. */
function layeredPressure(pressure: number): number {
  return Math.min(1.5, 0.2 + pressure * 1.6);
}

/** What the brush is given for a Pencil pressure (a mouse or missing pressure counts as a light touch). */
export function brushPressure(kind: BrushSpec["kind"], pencilPressure: number | undefined): number {
  const p = pencilPressure === undefined || !Number.isFinite(pencilPressure) ? 0.25 : pencilPressure;
  return kind === "line" ? linePressure(p) : layeredPressure(p);
}

/** A block's drawing tool: a brush, its weight, colour and paper. */
export interface Medium {
  id: string;
  label: string;
  brush: string;
  kind: BrushSpec["kind"];
  weight: number;
  colour: string;
  paper: string;
}

/** Cream manila, the book's paper for the early schedules. */
export const MANILA = "#f4ead3";
const GRAPHITE = "#26231f";

function spec(name: string): BrushSpec {
  return BRUSHES.find((b) => b.name === name)!;
}

export const MEDIA: Record<string, Medium> = {
  // 3B sharpened to a fine point: about 0.6 mm.
  "pencil-contour": { id: "pencil-contour", label: "Pencil, fine point", brush: "2B", kind: "line", weight: 1.8, colour: GRAPHITE, paper: MANILA },
  // 3B or 4B with a blunt point: about 1 mm.
  "pencil-gesture": { id: "pencil-gesture", label: "Pencil, blunt point", brush: "2B", kind: "line", weight: 2.9, colour: GRAPHITE, paper: MANILA },
  // Lithograph crayon, the broken side pressed into the masses (Weight).
  "crayon-side": { id: "crayon-side", label: "Lithograph crayon, side", brush: "crayon", kind: "layered", weight: 6, colour: "#1c1a17", paper: MANILA },
  "crayon": { id: "crayon", label: "Lithograph crayon", brush: "crayon", kind: "layered", weight: spec("crayon").weight, colour: "#1c1a17", paper: MANILA },
  "pen": { id: "pen", label: "Dip pen and ink", brush: "pen", kind: "line", weight: spec("pen").weight, colour: "#141210", paper: MANILA },
  "conte": { id: "conte", label: "Black crayon", brush: "pastel", kind: "layered", weight: spec("pastel").weight, colour: "#1c1a17", paper: "#c9c1b3" },
  "charcoal": { id: "charcoal", label: "Charcoal", brush: "charcoal", kind: "layered", weight: spec("charcoal").weight, colour: "#1c1a17", paper: MANILA },
};

/** Exercises drawn with a fine contour line rather than a blunt gesture line. */
const CONTOUR = new Set([1, 3, 16, 17, 18, 21, 25]);

/**
 * The medium for a block, from its medium and exercise. Media without a brush yet
 * (watercolour, oil) are drawn in pencil until their stage.
 */
export function mediumFor(step: Pick<DrawStep, "ex" | "media">): Medium {
  const media = step.media;
  if (media.includes("lithograph_crayon")) return step.ex.includes(6) ? MEDIA["crayon-side"] : MEDIA.crayon;
  if (media.includes("pen_and_ink")) return MEDIA.pen;
  if (media.includes("black_white_crayon")) return MEDIA.conte;
  return step.ex.some((e) => CONTOUR.has(e)) ? MEDIA["pencil-contour"] : MEDIA["pencil-gesture"];
}

export function mediumById(id: string | undefined): Medium | undefined {
  return id ? MEDIA[id] : undefined;
}
