import { describe, expect, it } from "vitest";
import { analyseTargetStroke, versionsForExercise } from "../src/core/primitiveMetrics";
import { ALL_EXERCISE_TYPES, MIXED_EXERCISE_TYPES } from "../src/core/scheduler";
import {
  analyseTaperStroke,
  generateTaperTarget,
  PRESSURE_HIGH,
  PRESSURE_LOW,
  strokeWidthsMm,
  TAPER_PROFILES,
  taperOutlineCss,
  taperProfileWidths,
  targetWidthAtMm,
  WIDTH_MAX_MM,
  WIDTH_MIN_MM,
  widthFromPressureMm,
} from "../src/core/taper";
import { generateTarget, targetCheckpointsCss } from "../src/core/targets";
import type { RawSample, RawStroke, TaperProfile, TaperTarget } from "../src/core/types";

const PX = 5.2;
const VIEWPORT = { width: 1180, height: 690 };

function pressureForWidth(widthMm: number): number {
  return PRESSURE_LOW + ((widthMm - WIDTH_MIN_MM) / (WIDTH_MAX_MM - WIDTH_MIN_MM)) * (PRESSURE_HIGH - PRESSURE_LOW);
}

function target(profile: TaperProfile, lengthMm = 60): TaperTarget {
  return {
    kind: "TAPER",
    aCss: { x: 100, y: 200 },
    bCss: { x: 100 + lengthMm * PX, y: 200 },
    lengthMm,
    profile,
    widthsMm: taperProfileWidths(profile, 0.7, 2.6, 1.8),
  };
}

/**
 * A stroke along the target from `from` to `to` (fractions of the line), with the width at each sample chosen by
 * `widthAt(t)`. Touch-down and lift carry the browser's placeholder pressures.
 */
function stroke(taper: TaperTarget, widthAt: (t: number) => number | undefined, options: { from?: number; to?: number; count?: number; offsetMm?: number } = {}): RawStroke {
  const { from = 0, to = 1, count = 60, offsetMm = 0 } = options;
  const samples: RawSample[] = Array.from({ length: count }, (_, index) => {
    const t = from + ((to - from) * index) / (count - 1);
    const width = widthAt(t);
    return {
      xCss: taper.aCss.x + (taper.bCss.x - taper.aCss.x) * t,
      yCss: taper.aCss.y + (taper.bCss.y - taper.aCss.y) * t + offsetMm * PX,
      tMs: index * 16,
      pressure: index === 0 ? 0.08 : index === count - 1 ? 0 : width === undefined ? undefined : pressureForWidth(width),
      sourceEventType: index === 0 ? "pointerdown" : index === count - 1 ? "pointerup" : "pointermove",
    };
  });
  if (widthAt(0) === undefined) for (const sample of samples) sample.pressure = undefined;
  return { id: "taper-stroke", pointerType: "pen", startedAtEpochMs: 0, cancelled: false, samples };
}

describe("taper width model", () => {
  it("maps pressure 0.03–0.5 linearly to 0.5–3 mm and clamps outside it", () => {
    expect(widthFromPressureMm(0.03)).toBeCloseTo(0.5, 9);
    expect(widthFromPressureMm(0.5)).toBeCloseTo(3, 9);
    expect(widthFromPressureMm(0.265)).toBeCloseTo(1.75, 9);
    expect(widthFromPressureMm(0)).toBeCloseTo(0.5, 9);
    expect(widthFromPressureMm(1)).toBeCloseTo(3, 9);
  });

  it("ignores the placeholder pressures on the first and last sample", () => {
    const widths = strokeWidthsMm(stroke(target("EVEN"), () => 1.8).samples);
    expect(widths[0]).toBeCloseTo(1.8, 9);
    expect(widths.at(-1)).toBeCloseTo(1.8, 9);
  });

  it("builds the four profiles with tapers spanning at least a third of the line", () => {
    const even = target("EVEN");
    expect([0, 0.3, 0.5, 1].map((t) => targetWidthAtMm(even, t))).toEqual([1.8, 1.8, 1.8, 1.8]);
    const rising = target("THIN_TO_THICK");
    expect(targetWidthAtMm(rising, 0)).toBeCloseTo(0.7, 9);
    expect(targetWidthAtMm(rising, 1)).toBeCloseTo(2.6, 9);
    // Linear over the whole line: still changing a third of the way along and two thirds along.
    expect(targetWidthAtMm(rising, 1 / 3)).toBeCloseTo(0.7 + 1.9 / 3, 9);
    expect(targetWidthAtMm(target("THICK_TO_THIN"), 0.25)).toBeCloseTo(targetWidthAtMm(rising, 0.75), 9);
    const swell = target("THIN_THICK_THIN");
    expect(targetWidthAtMm(swell, 0.5)).toBeCloseTo(2.6, 9);
    expect(targetWidthAtMm(swell, 0.25)).toBeCloseTo(targetWidthAtMm(swell, 0.75), 9);
  });

  it("outlines the ideal stroke at the wanted half-width either side of the line", () => {
    const outline = taperOutlineCss(target("THIN_TO_THICK"), PX);
    const ys = outline.map((point) => point.y - 200);
    expect(Math.max(...ys)).toBeCloseTo((2.6 * PX) / 2, 6);
    expect(Math.min(...ys)).toBeCloseTo((-2.6 * PX) / 2, 6);
    expect(outline[0]).toEqual(outline.at(-1));
  });
});

describe("taper generation", () => {
  it("is deterministic, 60–110 mm long, inside the margins, and uses every profile", () => {
    const seen = new Set<TaperProfile>();
    for (let index = 0; index < 80; index += 1) {
      const taper = generateTaperTarget(VIEWPORT, PX, "taper-seed", index);
      expect(generateTaperTarget(VIEWPORT, PX, "taper-seed", index)).toEqual(taper);
      expect(taper.lengthMm).toBeGreaterThanOrEqual(60);
      expect(taper.lengthMm).toBeLessThanOrEqual(110);
      expect(Math.hypot(taper.bCss.x - taper.aCss.x, taper.bCss.y - taper.aCss.y) / PX).toBeCloseTo(taper.lengthMm, 6);
      for (const point of [taper.aCss, taper.bCss]) {
        expect(point.x).toBeGreaterThanOrEqual(34);
        expect(point.x).toBeLessThanOrEqual(VIEWPORT.width - 34);
        expect(point.y).toBeGreaterThanOrEqual(34);
        expect(point.y).toBeLessThanOrEqual(VIEWPORT.height - 34);
      }
      for (const width of taper.widthsMm) {
        expect(width).toBeGreaterThanOrEqual(WIDTH_MIN_MM);
        expect(width).toBeLessThanOrEqual(WIDTH_MAX_MM);
      }
      seen.add(taper.profile);
    }
    expect([...seen].sort()).toEqual([...TAPER_PROFILES].sort());
  });

  it("is reachable through generateTarget with three checkpoints, and stays out of the mixed modes", () => {
    const taper = generateTarget("TAPER", VIEWPORT, PX, "s", 0);
    expect(taper.kind).toBe("TAPER");
    expect(targetCheckpointsCss(taper, PX)).toHaveLength(3);
    expect(ALL_EXERCISE_TYPES).toContain("TAPER");
    expect(MIXED_EXERCISE_TYPES).not.toContain("TAPER");
    expect(versionsForExercise("TAPER")).toEqual({ metric: "taper-1", scoring: "taper-1" });
  });
});

describe("taper scoring", () => {
  it("scores a perfect stroke 100 for every profile, in either drawing direction", () => {
    for (const profile of TAPER_PROFILES) {
      const taper = target(profile);
      const forward = analyseTaperStroke(stroke(taper, (t) => targetWidthAtMm(taper, t)), taper, PX);
      const backward = analyseTaperStroke(stroke(taper, (t) => targetWidthAtMm(taper, t), { from: 1, to: 0 }), taper, PX);
      expect(forward.executionPassed).toBe(true);
      expect(forward.accuracyScore).toBe(100);
      expect(backward.accuracyScore).toBe(100);
      expect(forward.metrics.widthRmsErrorMm).toBeCloseTo(0, 6);
    }
  });

  it("compares width by position: a rising taper drawn by order from the wrong end scores low", () => {
    const taper = target("THIN_TO_THICK");
    // Drawn from b to a, but thin first and thick last (by order), so it is thick at a and thin at b.
    const wrong = analyseTaperStroke(stroke(taper, (t) => targetWidthAtMm(taper, 1 - t), { from: 1, to: 0 }), taper, PX);
    expect(wrong.executionPassed).toBe(true);
    expect(wrong.accuracyScore!).toBeLessThan(20);
  });

  it("scores a constant offset by the documented formula and reports section widths", () => {
    const taper = target("EVEN");
    const result = analyseTaperStroke(stroke(taper, () => 1.8 + 0.25), taper, PX);
    expect(result.metrics.widthRmsErrorMm).toBeCloseTo(0.25, 6);
    expect(result.metrics.normalizedError).toBeCloseTo(0.1, 6);
    expect(result.accuracyScore).toBe(Math.round(100 * Math.exp(-Math.pow(0.1 / 0.2, 1.35))));
    for (const width of result.metrics.drawnWidthsMm) expect(width).toBeCloseTo(2.05, 6);
    expect(result.metrics.targetWidthsMm).toEqual([1.8, 1.8, 1.8]);
  });

  it("weights the line by position, not by how many samples landed there", () => {
    const taper = target("EVEN");
    const even = analyseTaperStroke(stroke(taper, (t) => (t < 0.5 ? 1.3 : 1.8)), taper, PX);
    // Same widths, but the wrong half drawn slowly (many more samples there).
    const slow = stroke(taper, (t) => (t < 0.5 ? 1.3 : 1.8), { count: 200 });
    slow.samples = slow.samples.filter((sample, index) => sample.xCss < 100 + 30 * PX || index % 6 === 0 || index === slow.samples.length - 1);
    const weighted = analyseTaperStroke(slow, taper, PX);
    expect(weighted.metrics.widthRmsErrorMm).toBeCloseTo(even.metrics.widthRmsErrorMm, 2);
  });

  it("does not score strokes without pressure, half a line, or off the line", () => {
    const taper = target("EVEN");
    expect(analyseTaperStroke(stroke(taper, () => undefined), taper, PX).executionReason).toMatch(/pressure/i);
    const half = analyseTaperStroke(stroke(taper, () => 1.8, { to: 0.55 }), taper, PX);
    expect(half.executionPassed).toBe(false);
    expect(half.executionReason).toMatch(/whole line/);
    const off = analyseTaperStroke(stroke(taper, () => 1.8, { offsetMm: 6 }), taper, PX);
    expect(off.executionPassed).toBe(false);
    expect(off.executionReason).toMatch(/Stay on the line/);
  });

  it("is dispatched by analyseTargetStroke", () => {
    const taper = target("THIN_THICK_THIN");
    const result = analyseTargetStroke(stroke(taper, (t) => targetWidthAtMm(taper, t)), taper, PX);
    expect("widthRmsErrorMm" in result.metrics).toBe(true);
    expect(result.accuracyScore).toBe(100);
  });
});
