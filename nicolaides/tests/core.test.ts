import { describe, expect, it } from "vitest";
import muybridge from "../src/public/data/muybridge.json";
import { activeSeconds, addRepeat, COURSE, dayKey, defaultPlan, type DrawStep, firstUse, poseCount, poseDurations, scheduleOf, stepAt } from "../src/core/course";
import { assignPoses } from "../src/core/dayPoses";
import { dealPoses, frameUrl, type MuybridgeData, newDeck, plateOf, poolPlates, skipFrame } from "../src/core/poses";
import { DEFAULT_SETTINGS, isBlind, presentation, undoAllowed } from "../src/core/rules";
import { elapsedMs, goTo, newProgress, pause, phase, poseState, restartPose, restartStep, skipStep, start, tick } from "../src/core/session";
import { fitSheet, packStroke, type Sample, unpackStroke } from "../src/core/sheet";
import { MEDIA, mediumFor } from "../src/core/brushes";
import { laterFrame } from "../src/core/poses";
import { referenceView } from "../src/core/rules";
import { quantize, replayStroke, StrokePieces } from "../src/core/strokePieces";

const data = muybridge as unknown as MuybridgeData;

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("course", () => {
  it("has 25 schedules of five three-hour days", () => {
    expect(COURSE.schedules).toHaveLength(25);
    for (const s of COURSE.schedules) {
      expect(s.days.map((d) => d.label)).toEqual(["A", "B", "C", "D", "E"]);
      for (const d of s.days) expect(d.steps.reduce((sum, st) => sum + st.seconds, 0)).toBe(10800);
    }
    expect(Object.keys(COURSE.exercises)).toHaveLength(64);
  });

  it("repeats Schedule 10 once by default and can add repeats", () => {
    const plan = defaultPlan();
    expect(plan).toHaveLength(26);
    expect(plan.filter((o) => o.s === 10)).toEqual([{ s: 10, r: 0 }, { s: 10, r: 1 }]);
    const more = addRepeat(plan, 9);
    expect(more.slice(9, 13)).toEqual([{ s: 10, r: 0 }, { s: 10, r: 1 }, { s: 10, r: 2 }, { s: 11, r: 0 }]);
    expect(dayKey(more, { occ: 11, day: 2 })).toBe("S10-2-C");
  });

  it("uses the larger count of a range", () => {
    const contour = scheduleOf(1).days[1].steps[5] as DrawStep;
    expect(contour.count).toEqual([1, 2]);
    expect(poseCount(contour)).toBe(2);
    expect(poseDurations(contour)).toEqual([1800, 1800]);
    const quick = scheduleOf(7).days[1].steps[1] as DrawStep;
    expect(quick.ex).toEqual([18]);
    expect(poseCount(quick)).toBe(5);
    expect(poseDurations(quick)[0]).toBe(360);
  });

  it("gives poses the book's stated length and cuts the slack from the block", () => {
    const s1b = scheduleOf(1).days[1];
    const gesture = s1b.steps[0] as DrawStep;
    expect([poseCount(gesture), poseDurations(gesture)[0], activeSeconds(gesture)]).toEqual([25, 60, 1500]);
    const short = s1b.steps[2] as DrawStep;
    expect([poseCount(short), poseDurations(short)[0], activeSeconds(short)]).toEqual([15, 60, 900]);
    const moving = scheduleOf(4).days[1].steps[4] as DrawStep;
    expect(moving.ex).toEqual([9]);
    expect([poseCount(moving), poseDurations(moving)[0], activeSeconds(moving)]).toEqual([8, 180, 1440]);
    const oil = scheduleOf(22).days[0].steps.find((st) => st.kind === "draw" && st.ex[0] === 52 && st.seconds === 1800) as DrawStep;
    expect([poseDurations(oil)[0], activeSeconds(oil)]).toEqual([300, 1500]);
    // "One- or five-minute poses", 5–25 in half an hour: ten quick, then four long.
    const straight = scheduleOf(19).days[2].steps.find((st) => st.kind === "draw" && st.ex[0] === 46 && st.seconds === 1800) as DrawStep;
    expect(straight.count).toEqual([5, 25]);
    expect(poseDurations(straight)).toEqual([...Array(10).fill(60), 300, 300, 300, 300]);
    const s23a = scheduleOf(23).days[0].steps.find((st) => st.kind === "draw" && st.ex[0] === 54) as DrawStep;
    expect(poseDurations(s23a)).toEqual([60, 60, 60, 60, 60, 300, 300]);
    expect(poseState(straight, 11 * 60_000)).toMatchObject({ index: 10, poseLeftMs: 4 * 60_000 });
    // No stated length: the block is shared evenly and keeps its time.
    const contour = scheduleOf(1).days[0].steps[0] as DrawStep;
    expect(activeSeconds(contour)).toBe(1800);
  });

  it("finds the first eraser exercise in Schedule 11", () => {
    const plan = defaultPlan();
    const first = firstUse(plan, 28)!;
    expect(plan[first.occ].s).toBe(11);
    expect(undoAllowed(plan, { occ: 0, day: 0, step: 0 }, DEFAULT_SETTINGS)).toBe(false);
    expect(undoAllowed(plan, { occ: 0, day: 0, step: 0 }, { ...DEFAULT_SETTINGS, earlyUndo: true })).toBe(true);
    expect(undoAllowed(plan, { occ: first.occ, day: 0, step: 0 }, DEFAULT_SETTINGS)).toBe(true);
  });
});

describe("session clock", () => {
  it("runs blocks back to back, stops at the rest, and resumes after it", () => {
    let p = newProgress();
    expect(phase(p)).toBe("ready");
    p = start(p, 0);
    // Schedule 1 A: 30, 30, 15 min, rest, 30, 60.
    p = tick(p, 30 * 60_000 + 5);
    expect(p.place.step).toBe(1);
    expect(elapsedMs(p, 30 * 60_000 + 5)).toBe(5);
    p = pause(p, 40 * 60_000);
    expect(phase(p)).toBe("paused");
    p = start(p, 100 * 60_000);
    p = tick(p, 100 * 60_000 + 20 * 60_000 + 15 * 60_000);
    expect(p.place.step).toBe(3);
    expect(phase(p)).toBe("rest");
    p = start(p, 200 * 60_000);
    expect(p.place.step).toBe(4);
    expect(phase(p)).toBe("running");
  });

  it("stops at the end of the day and the next Start begins the next day", () => {
    let p = goTo(newProgress(), { occ: 0, day: 0, step: 5 });
    p = start(p, 0);
    p = tick(p, 60 * 60_000);
    expect(p.finished).toBe("S1-0-A");
    expect(p.place).toEqual({ occ: 0, day: 1, step: 0 });
    expect(phase(p)).toBe("ready");
    p = goTo(p, { occ: 0, day: 4, step: 5 });
    p = tick(start(p, 0), 60 * 60_000);
    expect(p.place).toEqual({ occ: 1, day: 0, step: 0 });
  });

  it("marks the course complete after the last day", () => {
    const plan = defaultPlan();
    const last = scheduleOf(25).days[4];
    let p = goTo(newProgress(), { occ: plan.length - 1, day: 4, step: last.steps.length - 1 });
    p = tick(start(p, 0), last.steps.at(-1)!.seconds * 1000);
    expect(phase(p)).toBe("complete");
  });

  it("skips and restarts blocks", () => {
    let p = start(newProgress(), 0);
    p = skipStep(p, 1000);
    expect(p.place.step).toBe(1);
    expect(elapsedMs(p, 3000)).toBe(2000);
    p = restartStep(p, 5000);
    expect(elapsedMs(p, 6000)).toBe(1000);
    p = skipStep(skipStep(p, 7000), 7000);
    expect(phase(p)).toBe("rest");
  });

  it("works out the pose and time left", () => {
    const step = stepAt(defaultPlan(), { occ: 0, day: 1, step: 0 }) as DrawStep;
    expect(poseState(step, 0)).toEqual({ index: 0, count: 25, poseLeftMs: 60_000, stepLeftMs: 1_500_000 });
    expect(poseState(step, 61_000).index).toBe(1);
    expect(poseState(step, 1_500_000).index).toBe(24);
  });

  it("ends a gesture block after its 25 minutes of poses", () => {
    let p = start(goTo(newProgress(), { occ: 0, day: 1, step: 0 }), 0);
    p = tick(p, 25 * 60_000);
    expect(p.place.step).toBe(1);
  });

  it("gives a skipped pose its full time again", () => {
    const step = stepAt(defaultPlan(), { occ: 0, day: 1, step: 0 }) as DrawStep;
    let p = start(goTo(newProgress(), { occ: 0, day: 1, step: 0 }), 0);
    p = restartPose(p, 130_000, step);
    expect(elapsedMs(p, 130_000)).toBe(120_000);
    expect(poseState(step, elapsedMs(p, 130_000))).toMatchObject({ index: 2, poseLeftMs: 60_000 });
  });
});

describe("Muybridge poses", () => {
  it("leaves the agreed plates out of the pool", () => {
    const pool = poolPlates(data);
    expect(pool.length).toBeGreaterThan(600);
    expect(pool.some((p) => p.n >= 537 && p.n <= 562)).toBe(false);
    expect(pool.some((p) => /child/i.test(p.title))).toBe(false);
    expect(pool.some((p) => p.title === "Walking")).toBe(false);
    expect(pool.some((p) => p.animal === "Horse")).toBe(true);
    expect(frameUrl(data, { plate: 26, frame: 0 })).toMatch(/^https:\/\/api\.nga\.gov\/iiif\/.+\/pct:.+\/full\/0\/default\.jpg$/);
  });

  it("never deals two frames of one plate in a day, and uses every plate before repeating", () => {
    const random = seeded(1);
    let deck = newDeck(data, random);
    const seen = new Set<number>();
    const pool = poolPlates(data).length;
    let days = 0;
    while (seen.size < pool) {
      const { poses, deck: next } = dealPoses(data, deck, 67, random);
      deck = next;
      const plates = poses.map((p) => p.plate);
      expect(new Set(plates).size).toBe(plates.length);
      for (const n of plates) {
        if (seen.size < pool - 67) expect(seen.has(n)).toBe(false);
        seen.add(n);
      }
      days += 1;
    }
    expect(days).toBe(Math.ceil(pool / 67));
  });

  it("gives a returning plate a frame it has not shown", () => {
    const small: MuybridgeData = { ...data, plates: data.plates.filter((p) => !p.out).slice(0, 3) };
    const random = seeded(2);
    let deck = newDeck(small, random);
    const frames = new Map<number, number[]>();
    for (let day = 0; day < 6; day += 1) {
      const r = dealPoses(small, deck, 3, random);
      deck = r.deck;
      for (const p of r.poses) frames.set(p.plate, [...(frames.get(p.plate) ?? []), p.frame]);
    }
    for (const list of frames.values()) expect(new Set(list).size).toBe(list.length);
  });

  it("skips a frame with its neighbours, then the whole camera view on a second skip", () => {
    // A pool plate with three camera rows of twelve.
    const plate = poolPlates(data).find((p) => p.f.length === 36 && p.rows === 3)!;
    const n = plate.n;
    expect(plateOf(data, n)).toBe(plate);
    const frameAt = (row: number, col: number) => plate.f.findIndex(([, r, c]) => r === row && c === col);
    let skipped = skipFrame(data, {}, { plate: n, frame: frameAt(1, 5) });
    expect(skipped[n].map((i) => plate.f[i].slice(1))).toEqual([[1, 3], [1, 4], [1, 5], [1, 6], [1, 7]]);
    skipped = skipFrame(data, skipped, { plate: n, frame: frameAt(1, 10) });
    expect(skipped[n]).toHaveLength(12);
    expect(skipped[n].every((i) => plate.f[i][1] === 1)).toBe(true);
    // Dealing never returns a skipped frame; the other cameras still come up.
    const only: MuybridgeData = { ...data, plates: [plate] };
    let deck = newDeck(only, seeded(5));
    for (let i = 0; i < 40; i += 1) {
      const r = dealPoses(only, deck, 1, seeded(i), skipped);
      deck = r.deck;
      expect(skipped[n]).not.toContain(r.poses[0].frame);
    }
  });

  it("assigns a day's poses and keeps one pose for a carried-on artwork", () => {
    const plan = defaultPlan();
    const random = seeded(3);
    const s7 = plan.findIndex((o) => o.s === 7);
    const a = assignPoses(data, newDeck(data, random), {}, plan, { occ: s7, day: 0 }, DEFAULT_SETTINGS, undefined, random);
    const b = assignPoses(data, a.deck, a.groups, plan, { occ: s7, day: 1 }, DEFAULT_SETTINGS, undefined, random);
    expect(a.poses.steps[5]).toHaveLength(1);
    expect(b.poses.steps[5]).toEqual(a.poses.steps[5]);
    expect(a.poses.steps[0]).toHaveLength(25);
    expect(a.poses.steps[3]).toBeUndefined();
  });

  it("serves contour blind and honours a per-exercise real-life choice", () => {
    const step = stepAt(defaultPlan(), { occ: 0, day: 0, step: 0 }) as DrawStep;
    expect(step.ex).toEqual([1]);
    expect(isBlind(step)).toBe(true);
    expect(presentation(step, DEFAULT_SETTINGS).kind).toBe("muybridge");
    expect(presentation(step, { ...DEFAULT_SETTINGS, source: { 1: "life" } }).kind).toBe("life");
    const drapery = stepAt(defaultPlan(), { occ: defaultPlan().findIndex((o) => o.s === 11), day: 0, step: 0 }) as DrawStep;
    expect(presentation(drapery, DEFAULT_SETTINGS).kind).toBe("own");
  });
});

describe("sheets", () => {
  it("packs strokes without losing much", () => {
    const samples = [
      { x: 0.1234, y: 1.4321, pressure: 0.42, altitude: 0.9, azimuth: 3.1, t: 1000 },
      { x: 0.5, y: 0.25, pressure: undefined, altitude: 1.2, azimuth: 6.2, t: 1016 },
    ];
    const back = unpackStroke(packStroke(samples));
    expect(back[0].x).toBeCloseTo(0.1234, 4);
    expect(back[0].y).toBeCloseTo(1.4321, 4);
    expect(back[0].pressure).toBeCloseTo(0.42, 3);
    expect(back[1].pressure).toBeUndefined();
    expect(back[1].azimuth).toBeCloseTo(6.2, 3);
    expect(back.map((s) => s.t)).toEqual([0, 16]);
  });

  it("fits a sheet of fixed shape into any pane", () => {
    expect(fitSheet(0.75, 1000, 600, 0)).toEqual({ left: 100, top: 0, width: 800, height: 600 });
    expect(fitSheet(0.75, 400, 900, 0)).toEqual({ left: 0, top: 300, width: 400, height: 300 });
  });
});

describe("Stage 1", () => {
  it("draws each block in its medium", () => {
    const plan = defaultPlan();
    const at = (s: number, day: number, step: number) => stepAt(plan, { occ: plan.findIndex((o) => o.s === s), day, step }) as DrawStep;
    expect(mediumFor(at(1, 0, 0))).toBe(MEDIA["pencil-contour"]);
    expect(mediumFor(at(1, 1, 0))).toBe(MEDIA["pencil-gesture"]);
    const s3 = scheduleOf(3).days[0].steps.filter((st) => st.kind === "draw") as DrawStep[];
    expect(s3.map((st) => mediumFor(st).id)).toContain("crayon-side");
    const s3d = scheduleOf(3).days[3].steps.filter((st) => st.kind === "draw" && st.ex.includes(7)) as DrawStep[];
    expect(mediumFor(s3d[0]).id).toBe("crayon");
    expect(mediumFor(scheduleOf(5).days[0].steps[1] as DrawStep).id).toBe("pen");
  });

  it("cuts a stroke into the same seeded pieces live and on replay", () => {
    const samples: Sample[] = Array.from({ length: 40 }, (_, i) => quantize({ x: 0.1 + i * 0.002, y: 0.3 + Math.sin(i / 5) * 0.01, pressure: 0.3, t: i * 8 }));
    const live: string[] = [];
    const pieces = new StrokePieces(1234, (pts, seed) => live.push(`${seed}:${pts.map((p) => `${p.x},${p.y}`).join(" ")}`));
    for (const s of samples) pieces.add(s);
    pieces.finish();
    const stored = unpackStroke(packStroke(samples));
    const again: string[] = [];
    replayStroke(stored, 1234, (pts, seed) => again.push(`${seed}:${pts.map((p) => `${p.x},${p.y}`).join(" ")}`));
    expect(again).toEqual(live);
    expect(live.length).toBeGreaterThan(2);
    // A single touch still leaves a mark.
    const dot: number[] = [];
    replayStroke([samples[0]], 9, (pts, seed) => dot.push(pts.length, seed));
    expect(dot).toEqual([2, 9]);
  });

  it("flashes the pose for a second and shows what came next at the end of a potential gesture", () => {
    const flash = scheduleOf(2).days[2].steps.find((st) => st.kind === "draw" && st.ex.includes(5)) as DrawStep;
    expect(referenceView(flash, 500, 60_000).kind).toBe("pose");
    expect(referenceView(flash, 1000, 60_000).kind).toBe("hidden");
    const potential = scheduleOf(2).days[0].steps.find((st) => st.kind === "draw" && st.ex.includes(4)) as DrawStep;
    expect(referenceView(potential, 49_000, 60_000).kind).toBe("pose");
    expect(referenceView(potential, 50_000, 60_000).kind).toBe("next");
    const plate = poolPlates(data).find((p) => p.f.length === 36 && p.rows === 3)!;
    const first = plate.f.findIndex(([, r, c]) => r === 0 && c === 2);
    const later = laterFrame(data, { plate: plate.n, frame: first })!;
    expect(plate.f[later.frame].slice(1)).toEqual([0, 6]);
    const last = plate.f.findIndex(([, r, c]) => r === 0 && c === 11);
    expect(laterFrame(data, { plate: plate.n, frame: last })).toBeNull();
  });
});
