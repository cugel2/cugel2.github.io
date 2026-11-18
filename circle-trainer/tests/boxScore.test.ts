import { describe, expect, it } from "vitest";
import { BOX_1_SCORE_SIGMA, BOX_METRIC_VERSION, BOX_SCORE_SIGMA, BOX_SCORING_VERSION, boxScoreFromError } from "../src/core/boxMetrics";
import { versionsForExercise } from "../src/activities/drills/registry";

describe("box-2 score curve", () => {
  it("is a new scoring version on the unchanged box-1 metric", () => {
    expect(BOX_SCORING_VERSION).toBe("box-2");
    expect(BOX_METRIC_VERSION).toBe("box-1");
    expect(versionsForExercise("BOX")).toEqual({ metric: "box-1", scoring: "box-2" });
    expect(BOX_SCORE_SIGMA).toBe(0.4);
  });

  it("scores a perfect box 100 and the sigma error 37", () => {
    expect(boxScoreFromError(0)).toBe(100);
    expect(boxScoreFromError(BOX_SCORE_SIGMA)).toBe(37);
  });

  it("matches the agreed anchors: perfect boxes turned 10°, 20°, 30° wrong (errors 0.151, 0.309, 0.464)", () => {
    expect(boxScoreFromError(0.151)).toBe(76);
    expect(boxScoreFromError(0.309)).toBe(49);
    expect(boxScoreFromError(0.464)).toBe(29);
  });

  it("spreads John's rough boxes instead of zeroing them", () => {
    expect(boxScoreFromError(0.263)).toBe(57);
    expect(boxScoreFromError(0.52)).toBe(24);
    expect(boxScoreFromError(1.239)).toBe(1);
  });

  it("falls monotonically and stays within 0–100", () => {
    let previous = 101;
    for (let error = 0; error <= 3; error += 0.05) {
      const score = boxScoreFromError(error);
      expect(score).toBeLessThanOrEqual(previous);
      expect(score).toBeGreaterThanOrEqual(0);
      previous = score;
    }
    expect(boxScoreFromError(-1)).toBe(100);
  });

  it("reproduces box-1 when given its sigma (for reference; stored scores are never recomputed)", () => {
    expect(boxScoreFromError(0.263, BOX_1_SCORE_SIGMA)).toBe(12);
    expect(boxScoreFromError(0.515, BOX_1_SCORE_SIGMA)).toBe(1);
  });
});
