/* eslint-disable */
// Reference copy of the 0.15.4 drill drawing and text code (main.ts and trophyView.ts before restructure stage 1),
// verbatim apart from the wrapper that supplies the globals it read. Used only to prove stage 1 changed nothing.
import { arrowLabelCss, BOX_EDGES, BOX_FACES, boxAreas, boxShading, nonHingeEdgeIndices, swingArrowCss } from "../../src/core/box";
import { drawVariableWidthStroke } from "../../src/core/strokeRender";
import { sampleTargetPathCss, targetCheckpointsCss } from "../../src/core/targets";
import { strokeWidthsMm, taperCheckpointsCss, taperMetricText, taperOutlineCss, targetWidthAtMm } from "../../src/core/taper";
import type { AnalysisResult, BoxMetrics, BoxTarget, ExerciseType, Point2, RawStroke, TaperTarget, TargetDefinition, TrialRecord } from "../../src/core/types";

export interface ReferenceState {
  target: TargetDefinition;
  trialState: "PREPARING" | "READY" | "DRAWING" | "PROCESSING" | "FEEDBACK";
  boxStrokes: RawStroke[];
  activeStroke: RawStroke | null;
  completedStroke: RawStroke | null;
  targetCanvas: { width: number; height: number } | null;
  bounds: { width: number; height: number };
  px: number;
}

export function referenceRedraw(context: CanvasRenderingContext2D, state: ReferenceState): void {
  const cssPxPerMm = () => state.px;
  const { trialState, boxStrokes, activeStroke, completedStroke, targetCanvas } = state;
  const target: TargetDefinition | null = state.target;
  const canvas = { getBoundingClientRect: () => state.bounds };
const BOX_ACCENT = "#d2691e";
const BOX_REFERENCE_GREY = "#9a968d";
/** Hidden reference edges: the same grey, fainter, so the wireframe reads one way only. */
const BOX_HIDDEN_EDGE = "rgba(154, 150, 141, 0.38)";
const BOX_FACE_SHADE = "rgba(120, 114, 104, 0.16)";
const BOX_ANSWER_FACE_SHADE = "rgba(21, 87, 192, 0.14)";
/** The same face after the swing, when it has turned away from the viewer. */
const BOX_ANSWER_FACE_SHADE_AWAY = "rgba(21, 87, 192, 0.05)";


function drawLandmark(point: { x: number; y: number }): void {
  context.beginPath();
  context.arc(point.x, point.y, 6, 0, Math.PI * 2);
  context.fillStyle = "#fffefa";
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = "#171717";
  context.stroke();
}

function drawRawStroke(stroke: RawStroke): void {
  if (stroke.samples.length === 0) return;
  context.strokeStyle = "#171717";
  context.fillStyle = "#171717";
  context.lineWidth = 2.2;
  context.setLineDash([]);
  context.beginPath();
  context.arc(stroke.samples[0].xCss, stroke.samples[0].yCss, context.lineWidth / 2, 0, Math.PI * 2);
  context.fill();
  if (stroke.samples.length < 2) return;
  context.beginPath();
  context.moveTo(stroke.samples[0].xCss, stroke.samples[0].yCss);
  for (let index = 1; index < stroke.samples.length; index += 1) context.lineTo(stroke.samples[index].xCss, stroke.samples[index].yCss);
  context.stroke();
}

/** Taper strokes are drawn at their pressure-driven width (mm from pressure, so physical size, not screen px). */
function drawPressureStroke(stroke: RawStroke): void {
  const samples = stroke.samples;
  if (samples.length === 0) return;
  const px = cssPxPerMm();
  const widths = strokeWidthsMm(samples).map((width) => (width === null ? 2.2 : width * px));
  drawVariableWidthStroke(context, samples.map((sample) => ({ x: sample.xCss, y: sample.yCss })), widths);
}

/** Cue: a filled dot at the true wanted width, inside a faint ring so even a 0.5 mm dot can be found. */
function drawTaperCue(taper: TaperTarget): void {
  const px = cssPxPerMm();
  taperCheckpointsCss(taper).forEach((point, index) => {
    context.save();
    context.beginPath();
    context.arc(point.x, point.y, 11, 0, Math.PI * 2);
    context.strokeStyle = "rgba(23, 23, 23, 0.22)";
    context.lineWidth = 1;
    context.setLineDash([]);
    context.stroke();
    context.beginPath();
    context.arc(point.x, point.y, (targetWidthAtMm(taper, index / 2) * px) / 2, 0, Math.PI * 2);
    context.fillStyle = "#171717";
    context.fill();
    context.restore();
  });
}

function drawTaperOutline(taper: TaperTarget): void {
  const outline = taperOutlineCss(taper, cssPxPerMm());
  context.save();
  context.beginPath();
  context.moveTo(outline[0].x, outline[0].y);
  for (let index = 1; index < outline.length; index += 1) context.lineTo(outline[index].x, outline[index].y);
  context.strokeStyle = "#1557c0";
  context.lineWidth = 1.4;
  context.setLineDash([6, 4]);
  context.stroke();
  context.restore();
}

function drawIdealTarget(targetDefinition: TargetDefinition): void {
  const path = sampleTargetPathCss(targetDefinition, cssPxPerMm(), 512);
  context.save();
  context.beginPath();
  context.moveTo(path[0].x, path[0].y);
  for (let index = 1; index < path.length; index += 1) context.lineTo(path[index].x, path[index].y);
  context.strokeStyle = "#1557c0";
  context.lineWidth = 2;
  context.setLineDash([8, 6]);
  context.stroke();
  context.restore();
}

function strokeSegment(a: { x: number; y: number }, b: { x: number; y: number }): void {
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.stroke();
}

function drawHinge(corners: readonly { x: number; y: number }[], hingeEdgeIndex: number): void {
  const [a, b] = BOX_EDGES[hingeEdgeIndex];
  context.save();
  context.strokeStyle = BOX_ACCENT;
  context.lineWidth = 4;
  context.setLineDash([]);
  strokeSegment(corners[a], corners[b]);
  context.restore();
}

function drawBoxDivider(): void {
  // Divide the canvas the box was laid out for, so a kept box and its divider always agree.
  const bounds = targetCanvas ?? canvas.getBoundingClientRect();
  const { landscape } = boxAreas({ width: bounds.width, height: bounds.height });
  context.save();
  context.strokeStyle = "rgba(23, 23, 23, 0.1)";
  context.lineWidth = 1;
  context.setLineDash([]);
  if (landscape) strokeSegment({ x: bounds.width / 2, y: 24 }, { x: bounds.width / 2, y: bounds.height - 24 });
  else strokeSegment({ x: 24, y: bounds.height / 2 }, { x: bounds.width - 24, y: bounds.height / 2 });
  context.restore();
}

/**
 * The complete reference box (all 12 edges), its hinge, the swing arrow and the angle label.
 * Kept separate so a later "hide reference on first stroke" option only needs to skip this call.
 */
function fillFace(corners: readonly { x: number; y: number }[], faceIndex: number, color: string): void {
  const points = BOX_FACES[faceIndex].corners.map((corner) => corners[corner]);
  context.save();
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  context.restore();
}

function drawBoxReference(box: BoxTarget): void {
  const px = cssPxPerMm();
  const shading = boxShading(box);
  fillFace(box.referenceCornersCss, shading.faceIndex, BOX_FACE_SHADE);
  context.save();
  context.setLineDash([]);
  BOX_EDGES.forEach(([a, b], index) => {
    const hidden = shading.referenceHiddenEdges.includes(index);
    context.strokeStyle = hidden ? BOX_HIDDEN_EDGE : BOX_REFERENCE_GREY;
    context.lineWidth = hidden ? 1 : 1.3;
    strokeSegment(box.referenceCornersCss[a], box.referenceCornersCss[b]);
  });
  context.restore();
  drawHinge(box.referenceCornersCss, box.hingeEdgeIndex);

  drawSwingArrow(swingArrowCss(box, px), px);
  context.save();
  context.fillStyle = BOX_ACCENT;
  const label = arrowLabelCss(box, px);
  context.font = "600 15px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.strokeStyle = "rgba(255, 254, 250, 0.95)";
  context.lineWidth = 4;
  context.lineJoin = "round";
  context.strokeText(`${Math.abs(box.swingDeg)}°`, label.x, label.y);
  context.fillText(`${Math.abs(box.swingDeg)}°`, label.x, label.y);
  context.restore();
}

/**
 * Tail dot → curved shaft → large head, all over a paper-coloured halo so the arrow reads clearly even
 * where it crosses the reference box's grey edges.
 */
function drawSwingArrow(arrow: readonly { x: number; y: number }[], px: number): void {
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
    context.beginPath();
    context.moveTo(arrow[0].x, arrow[0].y);
    for (let index = 1; index < arrow.length - 1; index += 1) context.lineTo(arrow[index].x, arrow[index].y);
    context.lineTo(shaftEnd.x, shaftEnd.y);
  };
  const traceHead = (): void => {
    context.beginPath();
    context.moveTo(headPoints[0].x, headPoints[0].y);
    context.lineTo(headPoints[1].x, headPoints[1].y);
    context.lineTo(headPoints[2].x, headPoints[2].y);
    context.closePath();
  };
  const tailRadius = 3.2;
  context.save();
  context.setLineDash([]);
  context.lineCap = "round";
  context.lineJoin = "round";
  // Halo.
  context.strokeStyle = "rgba(255, 254, 250, 0.95)";
  context.fillStyle = "rgba(255, 254, 250, 0.95)";
  context.lineWidth = 8;
  tracePath();
  context.stroke();
  traceHead();
  context.stroke();
  context.beginPath();
  context.arc(arrow[0].x, arrow[0].y, tailRadius + 3, 0, Math.PI * 2);
  context.fill();
  // Arrow.
  context.strokeStyle = BOX_ACCENT;
  context.fillStyle = BOX_ACCENT;
  context.lineWidth = 2.6;
  tracePath();
  context.stroke();
  traceHead();
  context.fill();
  context.beginPath();
  context.arc(arrow[0].x, arrow[0].y, tailRadius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawBoxAnswer(box: BoxTarget): void {
  context.save();
  context.strokeStyle = "#1557c0";
  context.lineWidth = 2;
  context.setLineDash([8, 6]);
  for (const index of nonHingeEdgeIndices(box.hingeEdgeIndex)) {
    const [a, b] = BOX_EDGES[index];
    strokeSegment(box.answerCornersCss[a], box.answerCornersCss[b]);
  }
  context.restore();
}

function drawBoxTrial(box: BoxTarget): void {
  drawBoxDivider();
  drawBoxReference(box);
  if (trialState === "FEEDBACK") {
    // The same physical face as in the reference, under the strokes so they stay readable.
    const shading = boxShading(box);
    fillFace(box.answerCornersCss, shading.faceIndex, shading.answerFaceVisible ? BOX_ANSWER_FACE_SHADE : BOX_ANSWER_FACE_SHADE_AWAY);
  }
  for (const stroke of boxStrokes) drawRawStroke(stroke);
  if (activeStroke) drawRawStroke(activeStroke);
  if (trialState === "FEEDBACK") drawBoxAnswer(box);
  drawHinge(box.answerCornersCss, box.hingeEdgeIndex);
}


function redrawAll(): void {
  const bounds = canvas.getBoundingClientRect();
  context.clearRect(0, 0, bounds.width, bounds.height);
  if (!target) return;
  if (target.kind === "BOX") {
    drawBoxTrial(target);
    return;
  }
  if (target.kind === "TAPER") {
    // Cue first so the stroke covers it; the outline goes on top after lift.
    drawTaperCue(target);
    const stroke = activeStroke ?? completedStroke;
    if (stroke) drawPressureStroke(stroke);
    if (trialState === "FEEDBACK") drawTaperOutline(target);
    return;
  }
  if (activeStroke) drawRawStroke(activeStroke);
  else if (completedStroke) drawRawStroke(completedStroke);
  if (trialState === "FEEDBACK") drawIdealTarget(target);
  targetCheckpointsCss(target, cssPxPerMm()).forEach(drawLandmark);
}


  redrawAll();
}

export function referenceFeedbackDetails(activeExercise: ExerciseType, analysis: AnalysisResult): string {
function boxFeedbackDetail(metrics: BoxMetrics): string {
  const target = Math.abs(metrics.targetSwingDeg);
  const fitted = Math.round(Math.abs(metrics.fittedSwingDeg));
  const edges = `edges ${metrics.rmsOrthogonalDeviationMm.toFixed(1)} mm`;
  const wrongWay = fitted >= 1 && Math.sign(metrics.fittedSwingDeg) !== Math.sign(metrics.targetSwingDeg);
  return wrongWay
    ? `You swung it the wrong way (${fitted}°) · target ${target}° · ${edges}`
    : `You turned it ${fitted}° · target ${target}° · ${edges}`;
}

function feedbackDetails(analysis: AnalysisResult): string {
  const metrics = analysis.metrics;
  if ("fittedSwingDeg" in metrics) return boxFeedbackDetail(metrics);
  if ("widthRmsErrorMm" in metrics) return taperMetricText(metrics);
  if (activeExercise === "LINE" && "rmsOrthogonalDeviationMm" in metrics) {
    return `RMS error ${metrics.rmsOrthogonalDeviationMm.toFixed(1)} mm · endpoints ${metrics.endpointMeanErrorMm.toFixed(1)} mm`;
  }
  if (activeExercise === "CIRCLE" && "radialRmsMm" in metrics) {
    return `Radial error ${metrics.radialRmsMm.toFixed(1)} mm · closure ${metrics.closureMm.toFixed(1)} mm`;
  }
  if (activeExercise === "ELLIPSE" && "closureMm" in metrics) {
    return `Path error ${metrics.rmsDeviationMm.toFixed(1)} mm · closure ${metrics.closureMm.toFixed(1)} mm`;
  }
  if ("endpointMeanErrorMm" in metrics) {
    const pathError = "rmsDeviationMm" in metrics ? metrics.rmsDeviationMm : metrics.rmsOrthogonalDeviationMm;
    return `Path error ${pathError.toFixed(1)} mm · endpoints ${metrics.endpointMeanErrorMm.toFixed(1)} mm`;
  }
  return `Path error ${("rmsDeviationMm" in metrics ? metrics.rmsDeviationMm : 0).toFixed(1)} mm`;
}


  return feedbackDetails(analysis);
}

const INK = "#171717";
const IDEAL_BLUE = "#1557c0";
const BOX_ACCENT = "#d2691e";
const BOX_REFERENCE_GREY = "#9a968d";
interface Mark { points: Point2[]; color: string; width: number; dash?: number[]; arrow?: boolean; fill?: boolean; widths?: Array<number | null> }

export { trialMarks as referenceTrialMarks };
function trialMarks(trial: TrialRecord, cssPxPerMm: number): Mark[] {
  const marks: Mark[] = [];
  const strokeMark = (samples: ReadonlyArray<{ xCss: number; yCss: number }>): Mark => ({
    points: samples.map((sample) => ({ x: sample.xCss, y: sample.yCss })),
    color: INK,
    width: 1.6,
  });
  if (trial.exerciseType === "BOX") {
    const box = trial.target;
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
  }
  if (trial.target.kind === "TAPER") {
    const widths = strokeWidthsMm(trial.rawStroke.samples).map((width) => (width === null ? null : width * cssPxPerMm));
    marks.push({ ...strokeMark(trial.rawStroke.samples), widths });
    marks.push({ points: taperOutlineCss(trial.target, cssPxPerMm), color: IDEAL_BLUE, width: 1.2, dash: [5, 4] });
    return marks;
  }
  marks.push(strokeMark(trial.rawStroke.samples));
  marks.push({ points: sampleTargetPathCss(trial.target, cssPxPerMm, 256), color: IDEAL_BLUE, width: 1.4, dash: [5, 4] });
  return marks;
}


export function referenceTrophyMetricText(trial: TrialRecord): string {
  const metrics = trial.derived.metrics;
  if ("widthRmsErrorMm" in metrics) return taperMetricText(metrics);
  if ("fittedSwingDeg" in metrics) {
    const fitted = Math.round(Math.abs(metrics.fittedSwingDeg));
    const wrongWay = fitted >= 1 && Math.sign(metrics.fittedSwingDeg) !== Math.sign(metrics.targetSwingDeg);
    const turn = wrongWay ? `Swung the wrong way (${fitted}°)` : `Turned ${fitted}°`;
    return `${turn} · target ${Math.abs(metrics.targetSwingDeg)}° · edges ${metrics.rmsOrthogonalDeviationMm.toFixed(1)} mm`;
  }
  if ("rmsOrthogonalDeviationMm" in metrics) {
    return `RMS error ${metrics.rmsOrthogonalDeviationMm.toFixed(1)} mm · endpoints ${metrics.endpointMeanErrorMm.toFixed(1)} mm`;
  }
  if ("radialRmsMm" in metrics) return `Radial error ${metrics.radialRmsMm.toFixed(1)} mm · closure ${metrics.closureMm.toFixed(1)} mm`;
  if ("closureMm" in metrics) return `Path error ${metrics.rmsDeviationMm.toFixed(1)} mm · closure ${metrics.closureMm.toFixed(1)} mm`;
  // Arcs and S curves.
  return `Path error ${metrics.rmsDeviationMm.toFixed(1)} mm · endpoints ${metrics.endpointMeanErrorMm.toFixed(1)} mm`;
}


