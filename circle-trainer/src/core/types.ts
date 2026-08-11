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

export type ExerciseType = "LINE" | "ARC" | "CIRCLE" | "ELLIPSE" | "S_CURVE";
export type PracticeMode = ExerciseType | "MIXED_BLOCKED" | "MIXED_RANDOM";

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

export type TargetDefinition = LineTarget | ArcTarget | CircleTarget | EllipseTarget | SCurveTarget;

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

export type PrimitiveMetrics = LineMetrics | ArcMetrics | CircleMetrics | EllipseMetrics | SCurveMetrics;

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

export interface TrialRecord {
  id: string;
  appVersion: string;
  metricVersion: string;
  scoringVersion: string;
  createdAtEpochMs: number;
  exerciseType: ExerciseType;
  practiceMode: PracticeMode;
  schedule: ScheduleContext;
  target: TargetDefinition;
  rawStroke: RawStroke;
  calibrationId: string | null;
  derived: AnalysisResult;
}

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
  schemaVersion: "2";
  appVersion: string;
  exportedAt: number;
  calibration: PhysicalCalibration | null;
  selectedMode: PracticeMode;
  device: DeviceSnapshot;
  strokes: RawStroke[];
  trials: TrialRecord[];
}
