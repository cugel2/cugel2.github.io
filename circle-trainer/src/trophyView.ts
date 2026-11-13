import { BOX_EDGES, nonHingeEdgeIndices, swingArrowCss } from "./core/box";
import { EXERCISE_LABELS, MODE_LABELS } from "./core/scheduler";
import { sampleTargetPathCss } from "./core/targets";
import { TROPHY_ORDER, type TrophyCase } from "./core/trophies";
import type { ExerciseType, Point2, TrialRecord } from "./core/types";

const INK = "#171717";
const IDEAL_BLUE = "#1557c0";
const BOX_ACCENT = "#d2691e";
const BOX_REFERENCE_GREY = "#9a968d";
const SINGULAR: Record<ExerciseType, string> = { LINE: "line", ARC: "arc", CIRCLE: "circle", ELLIPSE: "ellipse", S_CURVE: "S curve", BOX: "box" };

interface Mark {
  points: Point2[];
  color: string;
  width: number;
  dash?: number[];
  /** Draw a small arrowhead at the last point and a dot at the first. */
  arrow?: boolean;
}

/** Everything the feedback screen showed for this trial, in the trial's original canvas coordinates. */
function trialMarks(trial: TrialRecord, cssPxPerMm: number): Mark[] {
  const marks: Mark[] = [];
  const strokeMark = (samples: ReadonlyArray<{ xCss: number; yCss: number }>): Mark => ({
    points: samples.map((sample) => ({ x: sample.xCss, y: sample.yCss })),
    color: INK,
    width: 1.6,
  });
  if (trial.exerciseType === "BOX") {
    const box = trial.target;
    for (const [a, b] of BOX_EDGES) marks.push({ points: [box.referenceCornersCss[a], box.referenceCornersCss[b]], color: BOX_REFERENCE_GREY, width: 1 });
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
  marks.push(strokeMark(trial.rawStroke.samples));
  marks.push({ points: sampleTargetPathCss(trial.target, cssPxPerMm, 256), color: IDEAL_BLUE, width: 1.4, dash: [5, 4] });
  return marks;
}

/** Draws a trial scaled to fit the canvas's CSS box. Line widths stay in screen pixels so small thumbnails stay legible. */
export function drawTrialThumbnail(canvas: HTMLCanvasElement, trial: TrialRecord, cssPxPerMm: number, lineScale = 1): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const context = canvas.getContext("2d");
  if (!context || width === 0 || height === 0) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const marks = trialMarks(trial, cssPxPerMm).filter((mark) => mark.points.length > 0);
  const all = marks.flatMap((mark) => mark.points);
  if (all.length === 0) return;
  const minX = Math.min(...all.map((point) => point.x));
  const maxX = Math.max(...all.map((point) => point.x));
  const minY = Math.min(...all.map((point) => point.y));
  const maxY = Math.max(...all.map((point) => point.y));
  const padding = 12 * lineScale;
  const scale = Math.min((width - padding * 2) / Math.max(maxX - minX, 1), (height - padding * 2) / Math.max(maxY - minY, 1), 1.5);
  const offsetX = (width - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (height - (maxY - minY) * scale) / 2 - minY * scale;
  const map = (point: Point2): Point2 => ({ x: offsetX + point.x * scale, y: offsetY + point.y * scale });

  context.lineCap = "round";
  context.lineJoin = "round";
  for (const mark of marks) {
    const points = mark.points.map(map);
    context.strokeStyle = mark.color;
    context.fillStyle = mark.color;
    context.lineWidth = mark.width * lineScale;
    context.setLineDash((mark.dash ?? []).map((value) => value * lineScale));
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
    context.stroke();
    if (mark.arrow && points.length > 3) {
      context.setLineDash([]);
      const tip = points.at(-1)!;
      const before = points.at(-4)!;
      const heading = Math.atan2(tip.y - before.y, tip.x - before.x);
      const head = 6 * lineScale;
      context.beginPath();
      context.moveTo(tip.x + Math.cos(heading) * head * 0.3, tip.y + Math.sin(heading) * head * 0.3);
      context.lineTo(tip.x + Math.cos(heading + 2.65) * head, tip.y + Math.sin(heading + 2.65) * head);
      context.lineTo(tip.x + Math.cos(heading - 2.65) * head, tip.y + Math.sin(heading - 2.65) * head);
      context.closePath();
      context.fill();
      context.beginPath();
      context.arc(points[0].x, points[0].y, 2 * lineScale, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** One line of the measurements behind the score. */
export function trophyMetricText(trial: TrialRecord): string {
  const metrics = trial.derived.metrics;
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

export interface TrophyViewElements {
  grid: HTMLElement;
  detail: HTMLElement;
  detailTitle: HTMLElement;
  detailScore: HTMLElement;
  detailMeta: HTMLElement;
  detailMetrics: HTMLElement;
  detailCanvas: HTMLCanvasElement;
}

/**
 * Renders the trophy grid (one card per exercise) and the single-trophy detail view.
 * `pxPerMmFor` returns the CSS px/mm the trial was most likely drawn with.
 */
export function createTrophyView(elements: TrophyViewElements, pxPerMmFor: (trial: TrialRecord) => number) {
  let trophies: TrophyCase = {};

  function showGrid(): void {
    elements.detail.hidden = true;
    elements.grid.hidden = false;
  }

  function showDetail(type: ExerciseType): void {
    const trial = trophies[type];
    if (!trial) return;
    elements.grid.hidden = true;
    elements.detail.hidden = false;
    elements.detailTitle.textContent = `Best ${SINGULAR[type]}`;
    elements.detailScore.textContent = `Accuracy ${trial.derived.accuracyScore}`;
    elements.detailMeta.textContent = `${formatDate(trial.createdAtEpochMs)} · ${MODE_LABELS[trial.practiceMode] ?? trial.practiceMode}`;
    elements.detailMetrics.textContent = trophyMetricText(trial);
    requestAnimationFrame(() => drawTrialThumbnail(elements.detailCanvas, trial, pxPerMmFor(trial), 1.4));
  }

  function render(next: TrophyCase): void {
    trophies = next;
    elements.grid.replaceChildren();
    const pending: Array<() => void> = [];
    for (const type of TROPHY_ORDER) {
      const trial = trophies[type];
      const card = document.createElement(trial ? "button" : "div");
      card.className = trial ? "trophy-card" : "trophy-card empty";
      const thumb = document.createElement("canvas");
      thumb.className = "trophy-thumb";
      thumb.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "trophy-label";
      label.textContent = EXERCISE_LABELS[type];
      const score = document.createElement("strong");
      score.textContent = trial ? String(trial.derived.accuracyScore) : "—";
      const date = document.createElement("span");
      date.className = "trophy-date";
      date.textContent = trial ? formatDate(trial.createdAtEpochMs) : "Not scored yet";
      card.append(thumb, label, score, date);
      if (trial && card instanceof HTMLButtonElement) {
        card.type = "button";
        card.setAttribute("aria-label", `${EXERCISE_LABELS[type]}: best accuracy ${trial.derived.accuracyScore}. Show larger`);
        card.addEventListener("click", () => showDetail(type));
        pending.push(() => drawTrialThumbnail(thumb, trial, pxPerMmFor(trial)));
      }
      elements.grid.append(card);
    }
    showGrid();
    requestAnimationFrame(() => pending.forEach((draw) => draw()));
  }

  return { render, showGrid };
}
