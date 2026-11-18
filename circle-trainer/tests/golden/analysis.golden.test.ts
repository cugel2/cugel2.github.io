import { describe, expect, it } from "vitest";
import {
  analyseBoxStrokes,
  analyseTargetStroke,
  analyseTaperStroke,
  answerCornersMmForSwing,
  BOX_EDGES,
  generateTarget,
  nonHingeEdgeIndices,
  PRESSURE_HIGH,
  PRESSURE_LOW,
  sampleTargetPathCss,
  taperMetricText,
  targetWidthAtMm,
  WIDTH_MAX_MM,
  WIDTH_MIN_MM,
  type BoxTarget,
  type Point2,
  type RawStroke,
  type TaperTarget,
} from "./api";
import { expectGolden } from "./golden";
import { portion, PX_PER_MM, resample, scaled, shifted, strokeFrom, VIEWPORTS } from "./fixtures";

/** The analysis, or the error it throws, so a case that throws today is pinned too. */
function outcome(run: () => unknown): unknown {
  try {
    return run();
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}

/* ---------- lines, arcs, circles, ellipses, S curves ---------- */

const PRIMITIVES = ["LINE", "ARC", "CIRCLE", "ELLIPSE", "S_CURVE"] as const;

function primitiveCases(path: readonly Point2[]): Record<string, RawStroke> {
  const backtracked = [...portion(path, 0, 0.7), ...portion(path, 0.7, 0.45), ...portion(path, 0.45, 1)];
  const end = path.at(-1)!;
  return {
    clean: strokeFrom(resample(path, 90), { seed: "clean", jitterMm: 0.3 }),
    reversed: strokeFrom(resample([...path].reverse(), 90), { seed: "reversed", jitterMm: 0.6 }),
    rough: strokeFrom(resample(scaled(path, 1.1), 70), { seed: "rough", jitterMm: 1.5 }),
    offset: strokeFrom(resample(shifted(path, 3, -2), 90), { seed: "offset", jitterMm: 0.4 }),
    partial: strokeFrom(resample(portion(path, 0, 0.55), 50), { seed: "partial", jitterMm: 0.3 }),
    backtracked: strokeFrom(backtracked, { seed: "backtracked", jitterMm: 0.3, stepMs: 4 }),
    slow: strokeFrom(resample(path, 90), { seed: "slow", jitterMm: 0.3, stepMs: 40 }),
    dot: strokeFrom([end, end, end], { seed: "dot" }),
  };
}

describe("golden: single-stroke analysis (analyseTargetStroke)", () => {
  for (const type of PRIMITIVES) {
    it(type, () => {
      const results = [["golden-a", 0], ["golden-b", 1]].map(([seed, index]) => {
        const target = generateTarget(type, VIEWPORTS.landscape, PX_PER_MM, seed as string, index as number);
        const path = sampleTargetPathCss(target, PX_PER_MM, 200);
        const cases = Object.fromEntries(Object.entries(primitiveCases(path)).map(([name, stroke]) => [name, {
          gateOn: outcome(() => analyseTargetStroke(stroke, target, PX_PER_MM, true)),
          gateOff: outcome(() => analyseTargetStroke(stroke, target, PX_PER_MM, false)),
        }]));
        return { seed, index, cases };
      });
      expectGolden(`analysis-${type}`, results);
    });
  }

  it("the gate defaults to on when the flag is left out", () => {
    const target = generateTarget("ARC", VIEWPORTS.landscape, PX_PER_MM, "golden-a", 0);
    const stroke = primitiveCases(sampleTargetPathCss(target, PX_PER_MM, 200)).backtracked;
    expect(analyseTargetStroke(stroke, target, PX_PER_MM)).toEqual(analyseTargetStroke(stroke, target, PX_PER_MM, true));
  });
});

/* ---------- tapers ---------- */

function pressureForWidth(widthMm: number): number {
  return PRESSURE_LOW + ((widthMm - WIDTH_MIN_MM) / (WIDTH_MAX_MM - WIDTH_MIN_MM)) * (PRESSURE_HIGH - PRESSURE_LOW);
}

/** One generated taper target of each profile, found by walking the sequence index of a fixed seed. */
function taperTargets(): Array<{ index: number; target: TaperTarget }> {
  const found = new Map<string, { index: number; target: TaperTarget }>();
  for (let index = 0; index < 200 && found.size < 4; index += 1) {
    const target = generateTarget("TAPER", VIEWPORTS.landscape, PX_PER_MM, "golden-taper", index) as TaperTarget;
    if (!found.has(target.profile)) found.set(target.profile, { index, target });
  }
  return [...found.values()];
}

function taperCases(target: TaperTarget): Record<string, RawStroke> {
  const line = resample([target.aCss, target.bCss], 80);
  // A small, smooth pressure wobble, plus Safari's placeholder pressures on the first and last sample.
  const matched = (reverse: boolean) => (index: number, fraction: number) => {
    if (index === 0) return 0.08;
    if (index === 79) return 0;
    const along = reverse ? 1 - fraction : fraction;
    return pressureForWidth(targetWidthAtMm(target, along)) + 0.012 * Math.sin(index * 0.7);
  };
  return {
    matched: strokeFrom(line, { seed: "taper-matched", jitterMm: 0.3, pressure: matched(false) }),
    reversed: strokeFrom([...line].reverse(), { seed: "taper-reversed", jitterMm: 0.5, pressure: matched(true) }),
    even: strokeFrom(line, { seed: "taper-even", jitterMm: 0.3, pressure: () => 0.2 }),
    heavy: strokeFrom(line, { seed: "taper-heavy", jitterMm: 0.3, pressure: () => 0.9 }),
    noPressure: strokeFrom(line, { seed: "taper-none", jitterMm: 0.3, pressure: () => undefined }),
    offLine: strokeFrom(shifted(line, 0, 6), { seed: "taper-off", jitterMm: 0.3, pressure: matched(false) }),
    partial: strokeFrom(portion(line, 0, 0.6), { seed: "taper-partial", jitterMm: 0.3, pressure: matched(false) }),
  };
}

describe("golden: taper analysis", () => {
  it("finds all four profiles", () => {
    expect(taperTargets().map(({ target }) => target.profile).sort()).toEqual(["EVEN", "THICK_TO_THIN", "THIN_THICK_THIN", "THIN_TO_THICK"]);
  });

  it("every profile and stroke kind, with its metric text", () => {
    const results = taperTargets().map(({ index, target }) => ({
      index,
      profile: target.profile,
      cases: Object.fromEntries(Object.entries(taperCases(target)).map(([name, stroke]) => {
        const gateOn = analyseTaperStroke(stroke, target, PX_PER_MM, true);
        const gateOff = analyseTaperStroke(stroke, target, PX_PER_MM, false);
        return [name, { gateOn, gateOff, text: taperMetricText(gateOn.metrics) }];
      })),
    }));
    expectGolden("analysis-TAPER", results);
  });

  it("analyseTargetStroke hands tapers to the taper analysis", () => {
    for (const { target } of taperTargets()) {
      for (const stroke of Object.values(taperCases(target))) {
        expect(analyseTargetStroke(stroke, target, PX_PER_MM, true)).toEqual(analyseTaperStroke(stroke, target, PX_PER_MM, true));
      }
    }
  });
});

/* ---------- boxes ---------- */

/** One stroke per non-hinge edge of the given corners, in a scrambled order with every other one drawn backwards. */
function boxStrokes(target: BoxTarget, cornersCss: readonly Point2[], seed: string, jitterMm: number, shrink = 0): RawStroke[] {
  const edges = nonHingeEdgeIndices(target.hingeEdgeIndex);
  const order = edges.map((_, index) => (index * 7) % edges.length);
  return order.map((which, position) => {
    const [a, b] = BOX_EDGES[edges[which]];
    let start = cornersCss[a];
    let end = cornersCss[b];
    if (position % 2 === 1) [start, end] = [end, start];
    const inset = (from: Point2, to: Point2) => ({ x: from.x + (to.x - from.x) * shrink, y: from.y + (to.y - from.y) * shrink });
    const points = resample([inset(start, end), inset(end, start)], 30);
    return strokeFrom(points, { seed: `${seed}:${position}`, jitterMm, startMs: 1_000 + position * 2_000, id: `${seed}-${position}` });
  });
}

function cornersForSwing(target: BoxTarget, swingDeg: number): Point2[] {
  return answerCornersMmForSwing(target, swingDeg, PX_PER_MM).map((point) => ({ x: point.x * PX_PER_MM, y: point.y * PX_PER_MM }));
}

describe("golden: box analysis (analyseBoxStrokes)", () => {
  it("good, rough, over-turned, wrong-way and half-turned boxes", () => {
    const results = [["golden-a", 0], ["golden-b", 1]].map(([seed, index]) => {
      const target = generateTarget("BOX", VIEWPORTS.landscape, PX_PER_MM, seed as string, index as number, "LEFT") as BoxTarget;
      const cases = {
        good: boxStrokes(target, target.answerCornersCss, "good", 0.3),
        rough: boxStrokes(target, target.answerCornersCss, "rough", 1.2, 0.08),
        overTurned: boxStrokes(target, cornersForSwing(target, target.swingDeg * 1.5), "over", 0.4),
        wrongWay: boxStrokes(target, cornersForSwing(target, -target.swingDeg), "wrong", 0.4),
        halfTurned: boxStrokes(target, cornersForSwing(target, target.swingDeg / 2), "half", 1),
        fewStrokes: boxStrokes(target, target.answerCornersCss, "few", 0.3).slice(0, 6),
      };
      return {
        seed,
        index,
        swingDeg: target.swingDeg,
        cases: Object.fromEntries(Object.entries(cases).map(([name, strokes]) => [name, outcome(() => analyseBoxStrokes(strokes, target, PX_PER_MM))])),
      };
    });
    expectGolden("analysis-BOX", results);
  });
});
