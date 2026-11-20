/**
 * The course: Nicolaides' 25 schedules, each five three-hour days (A–E) of timed
 * blocks, compacted from the research package by scripts/build-course.mjs.
 *
 * A schedule can be worked more than once (Schedule 10 must be repeated), so the
 * course is a plan of occurrences: (schedule, repeat). A place in the course is
 * (occurrence, day, step), all zero-based.
 */
import courseData from "../data/course.json";

export interface DrawStep {
  kind: "draw";
  ex: number[];
  seconds: number;
  /** Drawings or poses printed for the block: [least, most]. */
  count: [number, number];
  media: string[];
  modes: string[];
  subjects: string[];
  note?: string;
  /** Set when one artwork is carried on across days (e.g. the five-hour contour). */
  group?: string;
  choice?: number[];
}

export interface RestStep {
  kind: "rest";
  seconds: number;
}

export type Step = DrawStep | RestStep;

export interface Day {
  label: string;
  steps: Step[];
}

export interface Schedule {
  n: number;
  section: string;
  page: number;
  repeat: string;
  mandatoryRepeats: number;
  homework: string[];
  days: Day[];
}

export interface Course {
  exercises: Record<string, string>;
  schedules: Schedule[];
}

export const COURSE = courseData as unknown as Course;

export interface Occurrence {
  /** Schedule number, 1–25. */
  s: number;
  /** 0 the first time through, 1 for the first repeat, and so on. */
  r: number;
}

export interface Place {
  occ: number;
  day: number;
  step: number;
}

export function scheduleOf(n: number, course: Course = COURSE): Schedule {
  const schedule = course.schedules.find((s) => s.n === n);
  if (!schedule) throw new Error(`No schedule ${n}`);
  return schedule;
}

/** Every schedule once, plus the repeats the book requires (Schedule 10 twice). */
export function defaultPlan(course: Course = COURSE): Occurrence[] {
  return course.schedules.flatMap((s) => Array.from({ length: 1 + s.mandatoryRepeats }, (_, r) => ({ s: s.n, r })));
}

/** Adds another time through the schedule at `occ`, straight after its last occurrence in a row. */
export function addRepeat(plan: readonly Occurrence[], occ: number): Occurrence[] {
  const s = plan[occ].s;
  let end = occ;
  while (end + 1 < plan.length && plan[end + 1].s === s) end += 1;
  const r = Math.max(...plan.filter((o) => o.s === s).map((o) => o.r)) + 1;
  return [...plan.slice(0, end + 1), { s, r }, ...plan.slice(end + 1)];
}

export function dayAt(plan: readonly Occurrence[], place: Place, course: Course = COURSE): Day {
  return scheduleOf(plan[place.occ].s, course).days[place.day];
}

export function stepAt(plan: readonly Occurrence[], place: Place, course: Course = COURSE): Step {
  return dayAt(plan, place, course).steps[place.step];
}

/** The first step of the next day, or null at the end of the course. */
export function nextDay(plan: readonly Occurrence[], place: Place, course: Course = COURSE): Place | null {
  const days = scheduleOf(plan[place.occ].s, course).days.length;
  if (place.day + 1 < days) return { occ: place.occ, day: place.day + 1, step: 0 };
  if (place.occ + 1 < plan.length) return { occ: place.occ + 1, day: 0, step: 0 };
  return null;
}

/** The next step in the same day, or null when the day is over. */
export function nextStep(plan: readonly Occurrence[], place: Place, course: Course = COURSE): Place | null {
  const steps = dayAt(plan, place, course).steps.length;
  return place.step + 1 < steps ? { ...place, step: place.step + 1 } : null;
}

/** "S10-1-C": schedule, repeat and day, naming one book day in the course. */
export function dayKey(plan: readonly Occurrence[], place: Pick<Place, "occ" | "day">, course: Course = COURSE): string {
  const o = plan[place.occ];
  return `S${o.s}-${o.r}-${scheduleOf(o.s, course).days[place.day].label}`;
}

export function exerciseName(id: number, course: Course = COURSE): string {
  return course.exercises[String(id)] ?? `Exercise ${id}`;
}

/** "Contour Drawing", or "Gesture Drawing + The Figure with Drapery" for a combined block. */
export function stepName(step: Step, course: Course = COURSE): string {
  return step.kind === "rest" ? "Rest" : step.ex.map((id) => exerciseName(id, course)).join(" + ");
}

/**
 * Pose lengths the book states for an exercise. Where a table gives the block
 * more time than its poses need (25 one-minute gestures in a 30-minute block),
 * the slack was for a live model changing pose; the app needs none, so the
 * block ends when the poses are done.
 */
const POSE_SECONDS: Record<number, (count: number) => number> = {
  2: () => 60, // gesture: one minute
  4: () => 60, // potential gesture
  20: () => 60, // gesture of the features
  36: () => 60, // gesture in black and white
  9: () => 180, // moving action: about three minutes an action
  46: (count) => (count >= 15 ? 60 : 300), // straight and curved: one- or five-minute poses
  52: () => 300, // five-minute oil gestures
  54: (count) => (count >= 15 ? 60 : 300), // predominating shape: one- or five-minute poses
  58: () => 300, // gesture on coloured paper
};

/** Exercises the book times as "one- or five-minute poses". */
const ONE_OR_FIVE = new Set([46, 54]);

/**
 * Every pose's length in a block, in seconds, in order.
 *
 * - A "one- or five-minute" exercise with a range (5–25 in half an hour) warms up
 *   with one-minute poses, then about two-thirds of the block in five-minute ones:
 *   10 × 1 + 4 × 5 minutes in 30, 5 × 1 + 2 × 5 in 15.
 * - Otherwise a range takes the larger count (shorter poses, working quickly), each
 *   pose lasting the book's stated length, or an even share where none is stated.
 */
export function poseDurations(step: DrawStep): number[] {
  const low = Math.max(1, Math.min(step.count[0], step.count[1]));
  const high = Math.max(1, step.count[0], step.count[1]);
  const minutes = Math.floor(step.seconds / 60);
  if (low !== high && step.ex.some((e) => ONE_OR_FIVE.has(e)) && minutes >= 10) {
    const fives = Math.floor((minutes * 2) / 3 / 5);
    return [...Array<number>(minutes - fives * 5).fill(60), ...Array<number>(fives).fill(300)];
  }
  const even = step.seconds / high;
  const id = step.ex.find((e) => POSE_SECONDS[e]);
  const stated = id === undefined ? even : POSE_SECONDS[id](high);
  // A stated length that would overrun the printed block gives way to the table.
  return Array<number>(high).fill(stated * high <= step.seconds ? stated : even);
}

export function poseCount(step: DrawStep): number {
  return poseDurations(step).length;
}

/** How long a block actually runs: its poses, without the changeover slack. */
export function activeSeconds(step: Step): number {
  return step.kind === "draw" ? poseDurations(step).reduce((sum, s) => sum + s, 0) : step.seconds;
}

/** When each pose starts, in ms from the start of the block, plus the block's end. */
export function poseStartsMs(step: DrawStep): number[] {
  const starts = [0];
  for (const seconds of poseDurations(step)) starts.push(starts[starts.length - 1] + seconds * 1000);
  return starts;
}

/** Where `place` falls among every step of the course, for ordering. */
export function compareDays(a: Pick<Place, "occ" | "day">, b: Pick<Place, "occ" | "day">): number {
  return a.occ - b.occ || a.day - b.day;
}

/** The first place in the plan where any block uses exercise `id`, or null. */
export function firstUse(plan: readonly Occurrence[], id: number, course: Course = COURSE): Place | null {
  for (let occ = 0; occ < plan.length; occ += 1) {
    const days = scheduleOf(plan[occ].s, course).days;
    for (let day = 0; day < days.length; day += 1) {
      const step = days[day].steps.findIndex((s) => s.kind === "draw" && s.ex.includes(id));
      if (step >= 0) return { occ, day, step };
    }
  }
  return null;
}
