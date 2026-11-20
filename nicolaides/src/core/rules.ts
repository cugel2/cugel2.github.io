/** How each block is presented: where its reference comes from, blind contour, Undo. */
import { COURSE, type Course, type DrawStep, firstUse, type Occurrence, type Place, compareDays } from "./course";

/** Reference modes a Muybridge frame can serve (shown plainly for now). */
const MUYBRIDGE_MODES = new Set([
  "static_full_figure",
  "active_pose",
  "predict_next_pose",
  "flash_1_second_then_hide",
  "multi_pose_exposure_then_hide",
  "looped_action",
  "verbal_prompt_hidden_then_reveal",
  "imagined_mirror_then_verify",
  "multi_person_group",
  "orthogonal_view_imagined_then_verify",
  "same_pose_continued",
  "model_behind_student",
  "glimpse_then_draw",
  "live_figure_optional",
]);

/** "app": a reference in the app. "life": your own model or subject, the whole screen for drawing. */
export type ReferenceSource = "app" | "life";

export interface Settings {
  version: 1;
  hand: "left" | "right";
  /** Undo before Exercise 28 (the book allows no eraser until then). */
  earlyUndo: boolean;
  /** Per exercise id; missing means "app". */
  source: Record<string, ReferenceSource>;
}

export const DEFAULT_SETTINGS: Settings = { version: 1, hand: "left", earlyUndo: false, source: {} };

/** Contour exercises are drawn without looking at the page. */
export const BLIND_EXERCISES = [1, 17, 18];

export const PEEK_MS = 3000;

/** The first exercise that allows an eraser. */
export const ERASER_EXERCISE = 28;

export function canServeFromMuybridge(step: DrawStep): boolean {
  return step.modes.some((m) => MUYBRIDGE_MODES.has(m));
}

export type Presentation =
  | { kind: "muybridge" }
  | { kind: "life" }
  /** Your own reference: nothing in the app yet covers this subject (drapery, anatomy…). */
  | { kind: "own" };

export function presentation(step: DrawStep, settings: Settings): Presentation {
  if (step.ex.some((id) => settings.source[String(id)] === "life")) return { kind: "life" };
  return canServeFromMuybridge(step) ? { kind: "muybridge" } : { kind: "own" };
}

export function isBlind(step: DrawStep): boolean {
  return step.ex.some((id) => BLIND_EXERCISES.includes(id));
}

export function undoAllowed(plan: readonly Occurrence[], place: Place, settings: Settings, course: Course = COURSE): boolean {
  if (settings.earlyUndo) return true;
  const first = firstUse(plan, ERASER_EXERCISE, course);
  return first !== null && compareDays(place, first) >= 0;
}

/** The Flash Pose (Exercise 5): the pose shows for about a second, then is drawn from memory. */
export const FLASH_EXERCISE = 5;
export const FLASH_MS = 1000;

/** Potential Gesture (Exercise 4): draw what comes next; the plate's later frame shows at the end. */
export const POTENTIAL_EXERCISE = 4;
export const REVEAL_NEXT_MS = 10_000;

export type ReferenceView =
  | { kind: "pose" }
  | { kind: "hidden"; message: string }
  | { kind: "next"; message: string };

/** What the reference pane shows `poseElapsed` ms into a pose of `poseLength` ms. */
export function referenceView(step: DrawStep, poseElapsed: number, poseLength: number): ReferenceView {
  if (step.ex.includes(FLASH_EXERCISE) && poseElapsed >= FLASH_MS) return { kind: "hidden", message: "Draw it from memory" };
  if (step.ex.includes(POTENTIAL_EXERCISE) && poseLength - poseElapsed <= REVEAL_NEXT_MS) return { kind: "next", message: "What came next" };
  return { kind: "pose" };
}
