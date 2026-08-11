import { seededRandom, shuffle } from "./random";
import type { ExerciseType, PracticeMode, ScheduleContext } from "./types";

export const EXERCISE_TYPES: readonly ExerciseType[] = ["LINE", "ARC", "CIRCLE", "ELLIPSE", "S_CURVE"];

export const EXERCISE_LABELS: Record<ExerciseType, string> = {
  LINE: "Lines",
  ARC: "Arcs",
  CIRCLE: "Circles",
  ELLIPSE: "Ellipses",
  S_CURVE: "S Curves",
};

export const MODE_LABELS: Record<PracticeMode, string> = {
  ...EXERCISE_LABELS,
  MIXED_BLOCKED: "Mixed — Blocked",
  MIXED_RANDOM: "Mixed — Random",
};

function isExerciseType(mode: PracticeMode): mode is ExerciseType {
  return EXERCISE_TYPES.includes(mode as ExerciseType);
}

function orderedCycle(seed: string, cycleIndex: number, previous: ExerciseType | null): ExerciseType[] {
  const order = shuffle(EXERCISE_TYPES, seededRandom(`${seed}:schedule:${cycleIndex}`));
  if (previous && order[0] === previous) {
    const swapIndex = order.findIndex((value) => value !== previous);
    [order[0], order[swapIndex]] = [order[swapIndex], order[0]];
  }
  return order;
}

export class PracticeScheduler {
  readonly mode: PracticeMode;
  readonly sessionSeed: string;
  private sequenceIndex = 0;
  private cycleIndex = 0;
  private blockIndex = 0;
  private positionInBlock = 0;
  private order: ExerciseType[];

  constructor(mode: PracticeMode, sessionSeed: string) {
    this.mode = mode;
    this.sessionSeed = sessionSeed;
    this.order = isExerciseType(mode) ? [mode] : orderedCycle(sessionSeed, 0, null);
  }

  currentExercise(): ExerciseType {
    if (isExerciseType(this.mode)) return this.mode;
    if (this.mode === "MIXED_BLOCKED") return this.order[this.blockIndex];
    return this.order[this.positionInBlock];
  }

  context(): ScheduleContext {
    return {
      mode: this.mode,
      sessionSeed: this.sessionSeed,
      sequenceIndex: this.sequenceIndex,
      cycleIndex: this.cycleIndex,
      blockIndex: this.mode === "MIXED_BLOCKED" ? this.blockIndex : undefined,
      positionInBlock: this.mode === "MIXED_BLOCKED" ? this.positionInBlock : undefined,
    };
  }

  blockProgress(): { current: number; total: number } | null {
    return this.mode === "MIXED_BLOCKED" ? { current: this.positionInBlock + 1, total: 10 } : null;
  }

  advance(): void {
    this.sequenceIndex += 1;
    if (isExerciseType(this.mode)) return;

    if (this.mode === "MIXED_BLOCKED") {
      this.positionInBlock += 1;
      if (this.positionInBlock < 10) return;
      this.positionInBlock = 0;
      this.blockIndex += 1;
      if (this.blockIndex < EXERCISE_TYPES.length) return;
      const previous = this.order.at(-1) ?? null;
      this.cycleIndex += 1;
      this.blockIndex = 0;
      this.order = orderedCycle(this.sessionSeed, this.cycleIndex, previous);
      return;
    }

    this.positionInBlock += 1;
    if (this.positionInBlock < EXERCISE_TYPES.length) return;
    const previous = this.order.at(-1) ?? null;
    this.cycleIndex += 1;
    this.positionInBlock = 0;
    this.order = orderedCycle(this.sessionSeed, this.cycleIndex, previous);
  }
}
