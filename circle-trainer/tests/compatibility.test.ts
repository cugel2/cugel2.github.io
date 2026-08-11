import { describe, expect, it } from "vitest";
import { normalizeStoredTrial } from "../src/storage";
import type { LegacyLineTrialRecord } from "../src/core/types";

describe("historical line compatibility", () => {
  it("normalizes an old line record without changing its score or versions", () => {
    const legacy = {
      id: "old-line",
      appVersion: "0.2.0",
      metricVersion: "line-1",
      scoringVersion: "line-1",
      createdAtEpochMs: 123,
      target: { kind: "LINE", aCss: { x: 0, y: 0 }, bCss: { x: 100, y: 0 }, lengthMm: 100 },
      rawStroke: { id: "stroke", pointerType: "pen", startedAtEpochMs: 100, cancelled: false, samples: [] },
      calibrationId: "calibration",
      derived: {
        metrics: {
          endpointStartErrorMm: 1, endpointEndErrorMm: 1, endpointMeanErrorMm: 1,
          rmsOrthogonalDeviationMm: 1, maxOrthogonalDeviationMm: 2, pathLengthMm: 100,
          pathEfficiency: 0.99, totalTurningRad: 0.1, durationMs: 300,
          meanSpeedMmS: 333, normalizedError: 0.01,
        },
        executionPassed: true,
        accuracyScore: 91,
      },
    } satisfies LegacyLineTrialRecord;
    const normalized = normalizeStoredTrial(legacy, 7);
    expect(normalized.exerciseType).toBe("LINE");
    expect(normalized.practiceMode).toBe("LINE");
    expect(normalized.derived.accuracyScore).toBe(91);
    expect(normalized.scoringVersion).toBe("line-1");
  });
});
