/**
 * Chooses every pose of a book day when the day begins, so its frames can be
 * fetched ahead and the day works offline. Blocks that carry one artwork across
 * days (the five-hour contour, the long ink study…) keep one pose for the whole
 * group within that time through the schedule.
 */
import { COURSE, type Course, dayAt, type DrawStep, type Occurrence, type Place, poseCount } from "./course";
import { dealPoses, type Deck, type FrameRef, type MuybridgeData, type Random, type Skipped } from "./poses";
import { presentation, type Settings } from "./rules";

export interface DayPoses {
  /** Poses per step index. */
  steps: Record<number, FrameRef[]>;
}

/** Carried-on poses by "S<schedule>-<repeat>:<group id>". */
export type GroupPoses = Record<string, FrameRef>;

/** Names a carried-on artwork within one time through a schedule; stable when repeats are added. */
export function groupKey(occurrence: Occurrence, group: string): string {
  return `S${occurrence.s}-${occurrence.r}:${group}`;
}

export interface Assigned {
  poses: DayPoses;
  deck: Deck;
  groups: GroupPoses;
}

/**
 * Fills in poses for the day's Muybridge blocks that have none yet (all of them
 * for a new day; one block when its exercise is switched back to the app).
 */
export function assignPoses(
  data: MuybridgeData,
  deck: Deck,
  groups: GroupPoses,
  plan: readonly Occurrence[],
  place: Pick<Place, "occ" | "day">,
  settings: Settings,
  existing: DayPoses = { steps: {} },
  random: Random = Math.random,
  course: Course = COURSE,
  skipped: Skipped = {},
): Assigned {
  const day = dayAt(plan, { ...place, step: 0 }, course);
  const steps: Record<number, FrameRef[]> = { ...existing.steps };
  const nextGroups = { ...groups };
  const wanted: { index: number; count: number }[] = [];
  day.steps.forEach((step, index) => {
    if (step.kind !== "draw" || presentation(step, settings).kind !== "muybridge") return;
    const have = steps[index]?.length ?? 0;
    const need = step.group ? 1 : poseCount(step as DrawStep);
    if (have >= need) return;
    if (step.group && nextGroups[groupKey(plan[place.occ], step.group)]) {
      steps[index] = [nextGroups[groupKey(plan[place.occ], step.group)]];
      return;
    }
    // A day dealt before its block's count changed is topped up, keeping its poses.
    wanted.push({ index, count: need - have });
  });
  const total = wanted.reduce((sum, w) => sum + w.count, 0);
  const { poses, deck: nextDeck } = dealPoses(data, deck, total, random, skipped);
  let at = 0;
  for (const w of wanted) {
    steps[w.index] = [...(steps[w.index] ?? []), ...poses.slice(at, at + w.count)];
    at += w.count;
    const step = day.steps[w.index] as DrawStep;
    if (step.group && steps[w.index][0]) nextGroups[groupKey(plan[place.occ], step.group)] = steps[w.index][0];
  }
  return { poses: { steps }, deck: nextDeck, groups: nextGroups };
}

export function allPoses(poses: DayPoses): FrameRef[] {
  return Object.values(poses.steps).flat();
}
