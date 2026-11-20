/**
 * Where you are in the course and the clock, as pure functions over a stored
 * Progress. Time is counted from wall-clock timestamps, never timer ticks, so a
 * sitting can stop anywhere and the next Start resumes to the second.
 *
 * Rest blocks are pause points: the clock stops at a rest and the next Start
 * goes straight on to the following block. A finished day stops the clock too;
 * the next Start begins the next day. There is no calendar.
 */
import { activeSeconds, COURSE, type Course, dayKey, defaultPlan, type DrawStep, nextDay, nextStep, type Occurrence, type Place, poseStartsMs, stepAt } from "./course";

export interface Progress {
  version: 1;
  plan: Occurrence[];
  place: Place;
  /** Time already spent in the current step, in ms. */
  bankedMs: number;
  /** When the clock last started (epoch ms), or null while stopped. */
  since: number | null;
  /** The day just finished, shown until the next Start. */
  finished?: string;
  /** True once the last day of the plan is done. */
  complete?: boolean;
}

export function newProgress(course: Course = COURSE): Progress {
  return { version: 1, plan: defaultPlan(course), place: { occ: 0, day: 0, step: 0 }, bankedMs: 0, since: null };
}

export function isRunning(p: Progress): boolean {
  return p.since !== null;
}

export function elapsedMs(p: Progress, now: number): number {
  return p.bankedMs + (p.since === null ? 0 : Math.max(0, now - p.since));
}

export function stepMs(p: Progress, course: Course = COURSE): number {
  return activeSeconds(stepAt(p.plan, p.place, course)) * 1000;
}

export type Phase =
  | "ready" // the day has not begun
  | "running"
  | "paused" // stopped part-way through a block
  | "rest" // stopped at a rest block
  | "complete";

export function phase(p: Progress, course: Course = COURSE): Phase {
  if (p.complete) return "complete";
  if (p.since !== null) return "running";
  if (stepAt(p.plan, p.place, course).kind === "rest") return "rest";
  if (p.place.step === 0 && p.bankedMs === 0) return "ready";
  return "paused";
}

/** Moves to `place` with its clock at zero and stopped. */
export function goTo(p: Progress, place: Place): Progress {
  return { ...p, place, bankedMs: 0, since: null, finished: undefined, complete: false };
}

function stopAtDayEnd(p: Progress, course: Course): Progress {
  const key = dayKey(p.plan, p.place, course);
  const next = nextDay(p.plan, p.place, course);
  if (!next) return { ...p, bankedMs: stepMs(p, course), since: null, finished: key, complete: true };
  return { ...p, place: next, bankedMs: 0, since: null, finished: key };
}

export function start(p: Progress, now: number, course: Course = COURSE): Progress {
  if (p.complete || p.since !== null) return p;
  let q: Progress = { ...p, finished: undefined };
  // Start at a rest goes on to the block after it.
  while (stepAt(q.plan, q.place, course).kind === "rest") {
    const next = nextStep(q.plan, q.place, course);
    if (!next) return stopAtDayEnd(q, course);
    q = { ...q, place: next, bankedMs: 0 };
  }
  return { ...q, since: now };
}

export function pause(p: Progress, now: number): Progress {
  if (p.since === null) return p;
  return { ...p, bankedMs: elapsedMs(p, now), since: null };
}

/**
 * Moves on past every block whose time is up. Running into a rest or the end
 * of the day stops the clock; otherwise the next block starts with the time
 * left over, so nothing is lost between blocks.
 */
export function tick(p: Progress, now: number, course: Course = COURSE): Progress {
  let q = p;
  while (q.since !== null) {
    const over = elapsedMs(q, now) - stepMs(q, course);
    if (over < 0) return q;
    const next = nextStep(q.plan, q.place, course);
    if (!next) return stopAtDayEnd(q, course);
    if (stepAt(q.plan, next, course).kind === "rest") return { ...q, place: next, bankedMs: 0, since: null };
    q = { ...q, place: next, bankedMs: 0, since: now - over };
  }
  return q;
}

/** Skips the rest of the current block (to the next block, or the next day). */
export function skipStep(p: Progress, now: number, course: Course = COURSE): Progress {
  const running = p.since !== null;
  const next = nextStep(p.plan, p.place, course);
  if (!next) return stopAtDayEnd(p, course);
  const moved: Progress = { ...p, place: next, bankedMs: 0, since: running ? now : null, finished: undefined };
  return stepAt(moved.plan, next, course).kind === "rest" ? { ...moved, since: null } : moved;
}

/** Puts the current block's clock back to zero, keeping it running or stopped. */
export function restartStep(p: Progress, now: number): Progress {
  return { ...p, bankedMs: 0, since: p.since === null ? null : now };
}

/**
 * Starts the current pose's time again (after Skip pose), keeping the clock
 * running or stopped. The block runs that much longer.
 */
export function restartPose(p: Progress, now: number, step: DrawStep): Progress {
  const starts = poseStartsMs(step);
  const state = poseState(step, elapsedMs(p, now));
  return { ...p, bankedMs: starts[state.index], since: p.since === null ? null : now };
}

export interface PoseState {
  index: number;
  count: number;
  /** Time left in this pose and in the whole block, in ms. */
  poseLeftMs: number;
  stepLeftMs: number;
}

export function poseState(step: DrawStep, elapsed: number): PoseState {
  const starts = poseStartsMs(step);
  const count = starts.length - 1;
  const total = starts[count];
  let index = 0;
  while (index < count - 1 && elapsed >= starts[index + 1]) index += 1;
  return {
    index,
    count,
    poseLeftMs: Math.max(0, Math.min(total, starts[index + 1]) - elapsed),
    stepLeftMs: Math.max(0, total - elapsed),
  };
}
