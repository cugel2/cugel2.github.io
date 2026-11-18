import { analyseTargetStroke } from "../../../core/primitiveMetrics";
import { drawVariableWidthStroke } from "../../../core/strokeRender";
import {
  strokeWidthsMm,
  TAPER_METRIC_VERSION,
  TAPER_SCORING_VERSION,
  taperCheckpointsCss,
  taperMetricText,
  taperOutlineCss,
  targetWidthAtMm,
} from "../../../core/taper";
import { generateTarget } from "../../../core/targets";
import type { PrimitiveMetrics, RawStroke, TaperMetrics, TaperTarget } from "../../../core/types";
import { drawDashedPath, IDEAL_BLUE, singleStroke, strokeMark } from "../draw";
import type { Drill } from "../types";

/** Cue: a filled dot at the true wanted width, inside a faint ring so even a 0.5 mm dot can be found. */
function drawTaperCue(g: CanvasRenderingContext2D, taper: TaperTarget, px: number): void {
  taperCheckpointsCss(taper).forEach((point, index) => {
    g.save();
    g.beginPath();
    g.arc(point.x, point.y, 11, 0, Math.PI * 2);
    g.strokeStyle = "rgba(23, 23, 23, 0.22)";
    g.lineWidth = 1;
    g.setLineDash([]);
    g.stroke();
    g.beginPath();
    g.arc(point.x, point.y, (targetWidthAtMm(taper, index / 2) * px) / 2, 0, Math.PI * 2);
    g.fillStyle = "#171717";
    g.fill();
    g.restore();
  });
}

/** Taper strokes are drawn at their pressure-driven width (mm from pressure, so physical size, not screen px). */
function drawPressureStroke(g: CanvasRenderingContext2D, stroke: RawStroke, px: number): void {
  const samples = stroke.samples;
  if (samples.length === 0) return;
  const widths = strokeWidthsMm(samples).map((width) => (width === null ? 2.2 : width * px));
  drawVariableWidthStroke(g, samples.map((sample) => ({ x: sample.xCss, y: sample.yCss })), widths);
}

const text = (metrics: PrimitiveMetrics) => taperMetricText(metrics as TaperMetrics);

export const TAPER_DRILL: Drill<TaperTarget> = {
  id: "TAPER",
  label: "Tapers",
  singular: "taper",
  trophyNoun: "taper",
  versions: { metric: TAPER_METRIC_VERSION, scoring: TAPER_SCORING_VERSION },
  today: { count: 24, secondsPerRep: 5 },
  intro: {
    kicker: "Taper practice",
    prompt: "Draw one straight stroke through the three dots, pressing so its width matches each dot.",
    note: "The ideal outline appears in blue after you lift the Pencil.",
    compact: true,
  },
  revealName: "ideal path",
  strokesRequired: 1,
  usesCorrectionGate: true,
  controls: { undo: false, tips: false },
  generate: (canvas, cssPxPerMm, seed, index, handedness) => generateTarget("TAPER", canvas, cssPxPerMm, seed, index, handedness) as TaperTarget,
  analyse: (target, strokes, context) => analyseTargetStroke(strokes[0], target, context.cssPxPerMm, context.correctionGateEnabled),
  draw(g, scene) {
    // Cue first so the stroke covers it; the outline goes on top after lift.
    drawTaperCue(g, scene.target, scene.cssPxPerMm);
    const stroke = scene.activeStroke ?? scene.strokes[0] ?? null;
    if (stroke) drawPressureStroke(g, stroke, scene.cssPxPerMm);
    if (scene.feedback) drawDashedPath(g, taperOutlineCss(scene.target, scene.cssPxPerMm), 1.4, [6, 4]);
  },
  feedbackText: text,
  trophyText: text,
  trophyMarks(trial, cssPxPerMm) {
    const stroke = singleStroke(trial);
    const widths = strokeWidthsMm(stroke.samples).map((width) => (width === null ? null : width * cssPxPerMm));
    return [
      { ...strokeMark(stroke.samples), widths },
      { points: taperOutlineCss(trial.target as TaperTarget, cssPxPerMm), color: IDEAL_BLUE, width: 1.2, dash: [5, 4] },
    ];
  },
};
