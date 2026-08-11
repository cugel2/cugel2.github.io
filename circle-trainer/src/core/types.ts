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
}
