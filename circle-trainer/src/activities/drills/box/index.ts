import {
  arrowLabelCss,
  BOX_EDGES,
  BOX_FACES,
  BOX_STROKES_REQUIRED,
  boxAreas,
  boxShading,
  boxTargetRejection,
  buildBoxTarget,
  nonHingeEdgeIndices,
  swingArrowCss,
} from "../../../core/box";
import { analyseBoxStrokes, BOX_METRIC_VERSION, BOX_SCORING_VERSION } from "../../../core/boxMetrics";
import { polylineLength } from "../../../core/geometry";
import { generateTarget } from "../../../core/targets";
import type { BoxMetrics, BoxTarget, Handedness, Point2, PrimitiveMetrics, TrialRecord } from "../../../core/types";
import { drawRawStroke, IDEAL_BLUE, strokeMark, strokeSegment } from "../draw";
import type { CanvasSize, Drill, Mark } from "../types";

/** Box strokes shorter than this (or with fewer samples) are treated as accidental taps and not counted. */
const BOX_MIN_STROKE_SAMPLES = 8;
const BOX_MIN_STROKE_PATH_MM = 6;
const BOX_ACCENT = "#d2691e";
const BOX_REFERENCE_GREY = "#9a968d";
/** Hidden reference edges: the same grey, fainter, so the wireframe reads one way only. */
const BOX_HIDDEN_EDGE = "rgba(154, 150, 141, 0.38)";
const BOX_FACE_SHADE = "rgba(120, 114, 104, 0.16)";
const BOX_ANSWER_FACE_SHADE = "rgba(21, 87, 192, 0.14)";
/** The same face after the swing, when it has turned away from the viewer. */
const BOX_ANSWER_FACE_SHADE_AWAY = "rgba(21, 87, 192, 0.05)";

/* ---------- canvas drawing (moved unchanged from main.ts) ---------- */

function drawHinge(g: CanvasRenderingContext2D, corners: readonly Point2[], hingeEdgeIndex: number): void {
  const [a, b] = BOX_EDGES[hingeEdgeIndex];
  g.save();
  g.strokeStyle = BOX_ACCENT;
  g.lineWidth = 4;
  g.setLineDash([]);
  strokeSegment(g, corners[a], corners[b]);
  g.restore();
}

/** The line between the halves, for the canvas the box was laid out for, so a kept box and its divider always agree. */
function drawBoxDivider(g: CanvasRenderingContext2D, bounds: CanvasSize): void {
  const { landscape } = boxAreas({ width: bounds.width, height: bounds.height });
  g.save();
  g.strokeStyle = "rgba(23, 23, 23, 0.1)";
  g.lineWidth = 1;
  g.setLineDash([]);
  if (landscape) strokeSegment(g, { x: bounds.width / 2, y: 24 }, { x: bounds.width / 2, y: bounds.height - 24 });
  else strokeSegment(g, { x: 24, y: bounds.height / 2 }, { x: bounds.width - 24, y: bounds.height / 2 });
  g.restore();
}

function fillFace(g: CanvasRenderingContext2D, corners: readonly Point2[], faceIndex: number, color: string): void {
  const points = BOX_FACES[faceIndex].corners.map((corner) => corners[corner]);
  g.save();
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) g.lineTo(point.x, point.y);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.restore();
}

/**
 * The complete reference box (all 12 edges), its hinge, the swing arrow and the angle label.
 * Kept separate so a later "hide reference on first stroke" option only needs to skip this call.
 */
function drawBoxReference(g: CanvasRenderingContext2D, box: BoxTarget, px: number): void {
  const shading = boxShading(box);
  fillFace(g, box.referenceCornersCss, shading.faceIndex, BOX_FACE_SHADE);
  g.save();
  g.setLineDash([]);
  BOX_EDGES.forEach(([a, b], index) => {
    const hidden = shading.referenceHiddenEdges.includes(index);
    g.strokeStyle = hidden ? BOX_HIDDEN_EDGE : BOX_REFERENCE_GREY;
    g.lineWidth = hidden ? 1 : 1.3;
    strokeSegment(g, box.referenceCornersCss[a], box.referenceCornersCss[b]);
  });
  g.restore();
  drawHinge(g, box.referenceCornersCss, box.hingeEdgeIndex);

  drawSwingArrow(g, swingArrowCss(box, px), px);
  g.save();
  g.fillStyle = BOX_ACCENT;
  const label = arrowLabelCss(box, px);
  g.font = "600 15px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.strokeStyle = "rgba(255, 254, 250, 0.95)";
  g.lineWidth = 4;
  g.lineJoin = "round";
  g.strokeText(`${Math.abs(box.swingDeg)}°`, label.x, label.y);
  g.fillText(`${Math.abs(box.swingDeg)}°`, label.x, label.y);
  g.restore();
}

/**
 * Tail dot → curved shaft → large head, all over a paper-coloured halo so the arrow reads clearly even
 * where it crosses the reference box's grey edges.
 */
function drawSwingArrow(g: CanvasRenderingContext2D, arrow: readonly Point2[], px: number): void {
  const tip = arrow.at(-1)!;
  const before = arrow.at(-4) ?? arrow[0];
  const heading = Math.atan2(tip.y - before.y, tip.x - before.x);
  const head = Math.max(11, 2.4 * px);
  // Stop the shaft inside the head so its round cap doesn't poke out of the point.
  const shaftEnd = { x: tip.x - Math.cos(heading) * head * 0.5, y: tip.y - Math.sin(heading) * head * 0.5 };
  const headPoints = [
    { x: tip.x + Math.cos(heading) * head * 0.25, y: tip.y + Math.sin(heading) * head * 0.25 },
    { x: tip.x + Math.cos(heading + 2.65) * head, y: tip.y + Math.sin(heading + 2.65) * head },
    { x: tip.x + Math.cos(heading - 2.65) * head, y: tip.y + Math.sin(heading - 2.65) * head },
  ];
  const tracePath = (): void => {
    g.beginPath();
    g.moveTo(arrow[0].x, arrow[0].y);
    for (let index = 1; index < arrow.length - 1; index += 1) g.lineTo(arrow[index].x, arrow[index].y);
    g.lineTo(shaftEnd.x, shaftEnd.y);
  };
  const traceHead = (): void => {
    g.beginPath();
    g.moveTo(headPoints[0].x, headPoints[0].y);
    g.lineTo(headPoints[1].x, headPoints[1].y);
    g.lineTo(headPoints[2].x, headPoints[2].y);
    g.closePath();
  };
  const tailRadius = 3.2;
  g.save();
  g.setLineDash([]);
  g.lineCap = "round";
  g.lineJoin = "round";
  // Halo.
  g.strokeStyle = "rgba(255, 254, 250, 0.95)";
  g.fillStyle = "rgba(255, 254, 250, 0.95)";
  g.lineWidth = 8;
  tracePath();
  g.stroke();
  traceHead();
  g.stroke();
  g.beginPath();
  g.arc(arrow[0].x, arrow[0].y, tailRadius + 3, 0, Math.PI * 2);
  g.fill();
  // Arrow.
  g.strokeStyle = BOX_ACCENT;
  g.fillStyle = BOX_ACCENT;
  g.lineWidth = 2.6;
  tracePath();
  g.stroke();
  traceHead();
  g.fill();
  g.beginPath();
  g.arc(arrow[0].x, arrow[0].y, tailRadius, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawBoxAnswer(g: CanvasRenderingContext2D, box: BoxTarget): void {
  g.save();
  g.strokeStyle = "#1557c0";
  g.lineWidth = 2;
  g.setLineDash([8, 6]);
  for (const index of nonHingeEdgeIndices(box.hingeEdgeIndex)) {
    const [a, b] = BOX_EDGES[index];
    strokeSegment(g, box.answerCornersCss[a], box.answerCornersCss[b]);
  }
  g.restore();
}

/* ---------- re-layout after a resize ---------- */

/**
 * The same box placed in the halves of a new canvas, and how far its drawing half moved. Placement only shifts
 * each half (the box's size and shape do not depend on the canvas), so edges moved by `answerShiftCss` keep
 * exactly their position on the box and score exactly the same. Null if the box does not fit the new canvas.
 * (Moved from core/canvasSize.ts in 0.16.0.)
 */
export function relayoutBox(
  target: BoxTarget,
  canvas: CanvasSize,
  cssPxPerMm: number,
  handedness: Handedness,
): { target: BoxTarget; answerShiftCss: Point2 } | null {
  const moved = buildBoxTarget(target, canvas, cssPxPerMm, handedness);
  if (boxTargetRejection(moved, canvas, cssPxPerMm, handedness) !== null) return null;
  return {
    target: moved,
    answerShiftCss: { x: moved.answerOffsetCss.x - target.answerOffsetCss.x, y: moved.answerOffsetCss.y - target.answerOffsetCss.y },
  };
}

/* ---------- text ---------- */

function swing(metrics: BoxMetrics): { fitted: number; target: number; wrongWay: boolean; edges: string } {
  const fitted = Math.round(Math.abs(metrics.fittedSwingDeg));
  return {
    fitted,
    target: Math.abs(metrics.targetSwingDeg),
    wrongWay: fitted >= 1 && Math.sign(metrics.fittedSwingDeg) !== Math.sign(metrics.targetSwingDeg),
    edges: `edges ${metrics.rmsOrthogonalDeviationMm.toFixed(1)} mm`,
  };
}

/* ---------- the drill ---------- */

export const BOX_DRILL: Drill<BoxTarget> = {
  id: "BOX",
  label: "Boxes",
  singular: "box",
  trophyNoun: "box",
  versions: { metric: BOX_METRIC_VERSION, scoring: BOX_SCORING_VERSION },
  today: { count: 10, secondsPerRep: 30 },
  intro: {
    kicker: "Box practice",
    prompt: "Swing the box about the orange edge by the angle shown, then draw its other 11 edges from the lone orange edge — one stroke each.",
    note: "The true box appears in blue after the 11th edge.",
    compact: true,
  },
  revealName: "true box",
  strokesRequired: BOX_STROKES_REQUIRED,
  usesCorrectionGate: false,
  controls: { undo: true, tips: true },
  generate: (canvas, cssPxPerMm, seed, index, handedness) => generateTarget("BOX", canvas, cssPxPerMm, seed, index, handedness) as BoxTarget,
  acceptStroke(stroke, px) {
    const pathMm = polylineLength(stroke.samples.map((sample) => ({ x: sample.xCss / px, y: sample.yCss / px })));
    return stroke.samples.length < BOX_MIN_STROKE_SAMPLES || pathMm < BOX_MIN_STROKE_PATH_MM ? "Too short — not counted" : null;
  },
  relayout(target, canvas, cssPxPerMm, handedness) {
    const moved = relayoutBox(target, canvas, cssPxPerMm, handedness);
    return moved && { target: moved.target, strokeShift: moved.answerShiftCss };
  },
  analyse: (target, strokes, context) => analyseBoxStrokes(strokes, target, context.cssPxPerMm),
  draw(g, scene) {
    const box = scene.target;
    drawBoxDivider(g, scene.layoutCanvas);
    drawBoxReference(g, box, scene.cssPxPerMm);
    if (scene.feedback) {
      // The same physical face as in the reference, under the strokes so they stay readable.
      const shading = boxShading(box);
      fillFace(g, box.answerCornersCss, shading.faceIndex, shading.answerFaceVisible ? BOX_ANSWER_FACE_SHADE : BOX_ANSWER_FACE_SHADE_AWAY);
    }
    for (const stroke of scene.strokes) drawRawStroke(g, stroke);
    if (scene.activeStroke) drawRawStroke(g, scene.activeStroke);
    if (scene.feedback) drawBoxAnswer(g, box);
    drawHinge(g, box.answerCornersCss, box.hingeEdgeIndex);
  },
  feedbackText(metrics: PrimitiveMetrics) {
    const { fitted, target, wrongWay, edges } = swing(metrics as BoxMetrics);
    return wrongWay
      ? `You swung it the wrong way (${fitted}°) · target ${target}° · ${edges}`
      : `You turned it ${fitted}° · target ${target}° · ${edges}`;
  },
  trophyText(metrics: PrimitiveMetrics) {
    const { fitted, target, wrongWay, edges } = swing(metrics as BoxMetrics);
    const turn = wrongWay ? `Swung the wrong way (${fitted}°)` : `Turned ${fitted}°`;
    return `${turn} · target ${target}° · ${edges}`;
  },
  trophyMarks(trial: TrialRecord, cssPxPerMm: number): Mark[] {
    if (!("rawStrokes" in trial)) return [];
    const box = trial.target;
    const marks: Mark[] = [];
    const shading = boxShading(box);
    const face = (corners: Point2[]) => BOX_FACES[shading.faceIndex].corners.map((corner) => corners[corner]);
    marks.push({ points: face(box.referenceCornersCss), color: "rgba(120, 114, 104, 0.16)", width: 0, fill: true });
    marks.push({ points: face(box.answerCornersCss), color: shading.answerFaceVisible ? "rgba(21, 87, 192, 0.14)" : "rgba(21, 87, 192, 0.05)", width: 0, fill: true });
    BOX_EDGES.forEach(([a, b], index) => {
      const hidden = shading.referenceHiddenEdges.includes(index);
      marks.push({ points: [box.referenceCornersCss[a], box.referenceCornersCss[b]], color: hidden ? "rgba(154, 150, 141, 0.38)" : BOX_REFERENCE_GREY, width: 1 });
    });
    marks.push({ points: swingArrowCss(box, cssPxPerMm), color: BOX_ACCENT, width: 1.6, arrow: true });
    for (const stroke of trial.rawStrokes) marks.push(strokeMark(stroke.samples));
    for (const index of nonHingeEdgeIndices(box.hingeEdgeIndex)) {
      const [a, b] = BOX_EDGES[index];
      marks.push({ points: [box.answerCornersCss[a], box.answerCornersCss[b]], color: IDEAL_BLUE, width: 1.4, dash: [5, 4] });
    }
    const [ha, hb] = BOX_EDGES[box.hingeEdgeIndex];
    for (const corners of [box.referenceCornersCss, box.answerCornersCss]) marks.push({ points: [corners[ha], corners[hb]], color: BOX_ACCENT, width: 3 });
    return marks;
  },
};
