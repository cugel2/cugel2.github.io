export type StrokeEventType = "pointerdown" | "pointermove" | "pointerup";

export interface Point2 {
  x: number;
  y: number;
}

export interface RawSample {
  xCss: number;
  yCss: number;
  tMs: number;
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
  twist?: number;
  tangentialPressure?: number;
  width?: number;
  height?: number;
  sourceEventType: StrokeEventType;
}

export interface RawStroke {
  id: string;
  pointerType: string;
  startedAtEpochMs: number;
  completedAtEpochMs?: number;
  cancelled: boolean;
  samples: RawSample[];
}

export type PrimitiveExerciseType = "LINE" | "ARC" | "CIRCLE" | "ELLIPSE" | "S_CURVE";
/** One-stroke exercises: the primitives plus the pressure-width Taper drill (which is not part of the mixed modes). */
export type SingleStrokeExerciseType = PrimitiveExerciseType | "TAPER";
export type ExerciseType = SingleStrokeExerciseType | "BOX";
export type PracticeMode = ExerciseType | "MIXED_BLOCKED" | "MIXED_RANDOM";

/** The hand that holds the Pencil. Side-by-side layouts keep the reference away from it. */
export type Handedness = "LEFT" | "RIGHT";
export const DEFAULT_HANDEDNESS: Handedness = "LEFT";

export interface LineTarget {
  kind: "LINE";
  aCss: Point2;
  bCss: Point2;
  lengthMm: number;
}

export interface ArcTarget {
  kind: "ARC";
  centerCss: Point2;
  radiusMm: number;
  startAngleRad: number;
  sweepRad: number;
}

export interface CircleTarget {
  kind: "CIRCLE";
  centerCss: Point2;
  radiusMm: number;
  landmarkPhaseRad: number;
}

export interface EllipseTarget {
  kind: "ELLIPSE";
  centerCss: Point2;
  aMm: number;
  bMm: number;
  thetaRad: number;
}

export interface SCurveTarget {
  kind: "S_CURVE";
  centerCss: Point2;
  lengthMm: number;
  amplitudeStartMm: number;
  amplitudeEndMm: number;
  thetaRad: number;
}

export type TaperProfile = "EVEN" | "THIN_TO_THICK" | "THICK_TO_THIN" | "THIN_THICK_THIN";

/** A straight line drawn with pressure: the wanted stroke width varies linearly between start, middle and end. */
export interface TaperTarget {
  kind: "TAPER";
  aCss: Point2;
  bCss: Point2;
  lengthMm: number;
  profile: TaperProfile;
  /** Wanted stroke width at the start (a), middle and end (b). */
  widthsMm: [number, number, number];
}

/**
 * Hinge-swing box drill. The parameters fully determine the 3D scene; the projected corners (CSS px,
 * corner i has x/y/z sign from bits 0/1/2) are stored too so saved records are self-contained.
 */
export interface BoxTarget {
  kind: "BOX";
  dimensionsMm: [number, number, number];
  /** Unit quaternion [w, x, y, z] of the reference pose. */
  referenceRotation: [number, number, number, number];
  hingeEdgeIndex: number;
  /** Signed swing about the hinge edge (from its lower-index corner to its higher-index corner, right-handed). */
  swingDeg: number;
  cameraDistanceFactor: number;
  referenceOffsetCss: Point2;
  answerOffsetCss: Point2;
  referenceCornersCss: Point2[];
  answerCornersCss: Point2[];
}

export type PrimitiveTargetDefinition = LineTarget | ArcTarget | CircleTarget | EllipseTarget | SCurveTarget;
export type TargetDefinition = PrimitiveTargetDefinition | TaperTarget | BoxTarget;

export interface CommonMetrics {
  durationMs: number;
  pathLengthMm: number;
  meanSpeedMmS: number;
  rmsDeviationMm: number;
  maxDeviationMm: number;
  normalizedError: number;
}

export interface LineMetrics {
  endpointStartErrorMm: number;
  endpointEndErrorMm: number;
  endpointMeanErrorMm: number;
  rmsOrthogonalDeviationMm: number;
  maxOrthogonalDeviationMm: number;
  pathLengthMm: number;
  pathEfficiency: number;
  totalTurningRad: number;
  durationMs: number;
  meanSpeedMmS: number;
  normalizedError: number;
}

export interface ArcMetrics extends CommonMetrics {
  endpointMeanErrorMm: number;
  angularCoverageRad: number;
  expectedSweepRad: number;
  overshootRad: number;
  pathLengthRatio: number;
  curvatureSignReversals: number;
}

export interface CircleMetrics extends CommonMetrics {
  radialRmsMm: number;
  radialMaxMm: number;
  closureMm: number;
  angularCoverageRad: number;
  curvatureSignReversals: number;
}

export interface EllipseMetrics extends CommonMetrics {
  closureMm: number;
  angularCoverageRad: number;
  reverseCoverageRmsMm: number;
  canonicalRadialRms: number;
  curvatureSignReversals: number;
}

export interface SCurveMetrics extends CommonMetrics {
  endpointMeanErrorMm: number;
  reverseCoverageRmsMm: number;
  progression: number;
  backtrackingFraction: number;
  pathLengthRatio: number;
  curvatureSignTransitions: number;
}

export interface BoxEdgeMetric {
  edgeIndex: number;
  strokeId: string;
  rmsMm: number;
  endpointMm: number;
  angleErrorDeg: number;
}

export interface BoxMetrics {
  edges: BoxEdgeMetric[];
  /** sqrt(mean(rms_i^2)) over the matched edges. */
  rmsOrthogonalDeviationMm: number;
  /** sqrt(mean(endpoint_i^2)) over the matched edges. */
  endpointMeanErrorMm: number;
  meanAngleErrorDeg: number;
  fittedSwingDeg: number;
  targetSwingDeg: number;
  scaleMm: number;
  normalizedError: number;
  /** First sample of the first stroke to last sample of the last stroke. */
  durationMs: number;
  /** Sum of per-stroke durations (pen down only). */
  drawingDurationMs: number;
  pathLengthMm: number;
  strokeCount: number;
}

export interface TaperMetrics {
  /** RMS of (drawn width − wanted width) by position along the line, in mm. */
  widthRmsErrorMm: number;
  /** widthRmsErrorMm divided by the 2.5 mm width range. */
  normalizedError: number;
  /** Mean drawn width near the start, middle and end, in mm (null where the stroke left no width samples). */
  drawnWidthsMm: [number | null, number | null, number | null];
  targetWidthsMm: [number, number, number];
  /** Fraction of the line's length the stroke's width samples cover. */
  coverage: number;
  widthSampleCount: number;
  pathRmsMm: number;
  pathEndpointMeanErrorMm: number;
  pathLengthMm: number;
  durationMs: number;
}

export type PrimitiveMetrics = LineMetrics | ArcMetrics | CircleMetrics | EllipseMetrics | SCurveMetrics | TaperMetrics | BoxMetrics;

export interface AnalysisResult<M extends PrimitiveMetrics = PrimitiveMetrics> {
  metrics: M;
  executionPassed: boolean;
  executionReason?: string;
  accuracyScore?: number;
}

export interface ScheduleContext {
  mode: PracticeMode;
  sessionSeed: string;
  sequenceIndex: number;
  cycleIndex: number;
  generationIndex?: number;
  blockIndex?: number;
  positionInBlock?: number;
}

interface TrialRecordBase {
  id: string;
  appVersion: string;
  metricVersion: string;
  scoringVersion: string;
  createdAtEpochMs: number;
  practiceMode: PracticeMode;
  correctionGateEnabled: boolean;
  schedule: ScheduleContext;
  calibrationId: string | null;
}

export interface SingleStrokeTrialRecord extends TrialRecordBase {
  exerciseType: SingleStrokeExerciseType;
  target: TargetDefinition;
  rawStroke: RawStroke;
  derived: AnalysisResult;
}

export interface BoxTrialRecord extends TrialRecordBase {
  exerciseType: "BOX";
  target: BoxTarget;
  /** Accepted strokes in drawing order (undone and discarded strokes are not included). */
  rawStrokes: RawStroke[];
  derived: AnalysisResult<BoxMetrics>;
}

export type TrialRecord = SingleStrokeTrialRecord | BoxTrialRecord;

export interface LegacyLineTrialRecord {
  id: string;
  appVersion: string;
  metricVersion: string;
  scoringVersion: string;
  createdAtEpochMs: number;
  target: LineTarget;
  rawStroke: RawStroke;
  calibrationId: string | null;
  derived: AnalysisResult<LineMetrics>;
}

export interface PhysicalCalibration {
  id: string;
  cssPxPerMm: number;
  calibratedAt: number;
  viewportWidthCssPx: number;
  viewportHeightCssPx: number;
  devicePixelRatio: number;
}

export interface DeviceSnapshot {
  userAgent: string;
  viewportWidthCssPx: number;
  viewportHeightCssPx: number;
  devicePixelRatio: number;
  pointerEvents: boolean;
  coalescedEvents: boolean;
}

export interface ExportBundle {
  schemaVersion: "3";
  appVersion: string;
  exportedAt: number;
  calibration: PhysicalCalibration | null;
  selectedMode: PracticeMode;
  correctionGateEnabled: boolean;
  device: DeviceSnapshot;
  strokes: RawStroke[];
  trials: TrialRecord[];
}
