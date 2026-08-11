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

export interface LineTarget {
  kind: "LINE";
  aCss: Point2;
  bCss: Point2;
  lengthMm: number;
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

export interface LineTrialRecord {
  id: string;
  appVersion: string;
  metricVersion: string;
  scoringVersion: string;
  createdAtEpochMs: number;
  target: LineTarget;
  rawStroke: RawStroke;
  calibrationId: string | null;
  derived: {
    metrics: LineMetrics;
    executionPassed: boolean;
    executionReason?: string;
    accuracyScore?: number;
  };
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
  schemaVersion: "1";
  appVersion: string;
  exportedAt: number;
  calibration: PhysicalCalibration | null;
  device: DeviceSnapshot;
  strokes: RawStroke[];
  trials: LineTrialRecord[];
}
