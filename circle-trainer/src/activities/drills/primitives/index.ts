import { METRIC_VERSION as LINE_METRIC_VERSION, SCORING_VERSION as LINE_SCORING_VERSION } from "../../../core/lineMetrics";
import { analyseTargetStroke } from "../../../core/primitiveMetrics";
import { generateTarget, sampleTargetPathCss, targetCheckpointsCss } from "../../../core/targets";
import type {
  ArcMetrics,
  CircleMetrics,
  EllipseMetrics,
  LineMetrics,
  PrimitiveExerciseType,
  PrimitiveMetrics,
  PrimitiveTargetDefinition,
  SCurveMetrics,
} from "../../../core/types";
import { drawDashedPath, drawLandmark, drawRawStroke, IDEAL_BLUE, singleStroke, strokeMark } from "../draw";
import type { Drill } from "../types";

/**
 * Lines, arcs, circles, ellipses and S curves: one stroke through hollow checkpoints, the ideal path revealed in
 * dashed blue after lift. They differ only in their names, versions, Today counts and measurements line.
 */
interface PrimitiveSpec {
  id: PrimitiveExerciseType;
  label: string;
  singular: string;
  trophyNoun: string;
  versions: { metric: string; scoring: string };
  today: { count: number; secondsPerRep: number };
  kicker: string;
  prompt: string;
  /** The measurements line, on the feedback card and in the trophy detail alike. */
  text(metrics: PrimitiveMetrics): string;
}

function primitiveDrill(spec: PrimitiveSpec): Drill<PrimitiveTargetDefinition> {
  return {
    id: spec.id,
    label: spec.label,
    singular: spec.singular,
    trophyNoun: spec.trophyNoun,
    versions: spec.versions,
    today: spec.today,
    intro: { kicker: spec.kicker, prompt: spec.prompt, compact: false },
    revealName: "ideal path",
    strokesRequired: 1,
    usesCorrectionGate: true,
    controls: { undo: false, tips: false },
    generate: (canvas, cssPxPerMm, seed, index, handedness) =>
      generateTarget(spec.id, canvas, cssPxPerMm, seed, index, handedness) as PrimitiveTargetDefinition,
    analyse: (target, strokes, context) => analyseTargetStroke(strokes[0], target, context.cssPxPerMm, context.correctionGateEnabled),
    draw(g, scene) {
      const stroke = scene.activeStroke ?? scene.strokes[0] ?? null;
      if (stroke) drawRawStroke(g, stroke);
      if (scene.feedback) drawDashedPath(g, sampleTargetPathCss(scene.target, scene.cssPxPerMm, 512), 2, [8, 6]);
      targetCheckpointsCss(scene.target, scene.cssPxPerMm).forEach((point) => drawLandmark(g, point));
    },
    feedbackText: spec.text,
    trophyText: spec.text,
    trophyMarks: (trial, cssPxPerMm) => [
      strokeMark(singleStroke(trial).samples),
      { points: sampleTargetPathCss(trial.target, cssPxPerMm, 256), color: IDEAL_BLUE, width: 1.4, dash: [5, 4] },
    ],
  };
}

const mm = (value: number) => `${value.toFixed(1)} mm`;
/** Arcs and S curves. */
const pathAndEndpoints = (metrics: PrimitiveMetrics) => {
  const m = metrics as ArcMetrics | SCurveMetrics;
  return `Path error ${mm(m.rmsDeviationMm)} · endpoints ${mm(m.endpointMeanErrorMm)}`;
};

export const LINE_DRILL = primitiveDrill({
  id: "LINE", label: "Lines", singular: "line", trophyNoun: "line",
  versions: { metric: LINE_METRIC_VERSION, scoring: LINE_SCORING_VERSION },
  today: { count: 40, secondsPerRep: 3 },
  kicker: "Line practice", prompt: "Draw one committed stroke between the two points.",
  text: (metrics) => {
    const m = metrics as LineMetrics;
    return `RMS error ${mm(m.rmsOrthogonalDeviationMm)} · endpoints ${mm(m.endpointMeanErrorMm)}`;
  },
});

export const ARC_DRILL = primitiveDrill({
  id: "ARC", label: "Arcs", singular: "arc", trophyNoun: "arc",
  versions: { metric: "arc-2", scoring: "arc-1" },
  today: { count: 30, secondsPerRep: 4 },
  kicker: "Arc practice", prompt: "Draw one smooth arc through the three points.",
  text: pathAndEndpoints,
});

export const CIRCLE_DRILL = primitiveDrill({
  id: "CIRCLE", label: "Circles", singular: "circle", trophyNoun: "circle",
  versions: { metric: "circle-1", scoring: "circle-1" },
  today: { count: 24, secondsPerRep: 5 },
  kicker: "Circle practice", prompt: "Draw one full circle through the four points.",
  text: (metrics) => {
    const m = metrics as CircleMetrics;
    return `Radial error ${mm(m.radialRmsMm)} · closure ${mm(m.closureMm)}`;
  },
});

export const ELLIPSE_DRILL = primitiveDrill({
  id: "ELLIPSE", label: "Ellipses", singular: "ellipse", trophyNoun: "ellipse",
  versions: { metric: "ellipse-1", scoring: "ellipse-1" },
  today: { count: 24, secondsPerRep: 5 },
  kicker: "Ellipse practice", prompt: "Draw one full ellipse through the four points.",
  text: (metrics) => {
    const m = metrics as EllipseMetrics;
    return `Path error ${mm(m.rmsDeviationMm)} · closure ${mm(m.closureMm)}`;
  },
});

export const S_CURVE_DRILL = primitiveDrill({
  id: "S_CURVE", label: "S Curves", singular: "s curve", trophyNoun: "S curve",
  versions: { metric: "s-curve-2", scoring: "s-curve-1" },
  today: { count: 20, secondsPerRep: 6 },
  kicker: "S-curve practice", prompt: "Draw one smooth S curve through the four points.",
  text: pathAndEndpoints,
});
