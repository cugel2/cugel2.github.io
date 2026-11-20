/**
 * Nicolaides: press Start each day and draw. The app runs the book's timetable
 * block by block, deals Muybridge poses, keeps every sheet, and resumes to the
 * second after any break.
 */
import { activeSeconds, addRepeat, COURSE, dayAt, dayKey, type DrawStep, exerciseName, poseCount, poseDurations, scheduleOf, stepAt, stepName } from "./core/course";
import { allPoses, assignPoses, type DayPoses, groupKey, type GroupPoses } from "./core/dayPoses";
import { frameObjectUrl, prefetch, pruneFrames } from "./core/frames";
import { dealPoses, type Deck, frameCaption, frameUrl, type FrameRef, laterFrame, type MuybridgeData, newDeck, skipFrame, type Skipped } from "./core/poses";
import { DEFAULT_SETTINGS, isBlind, PEEK_MS, POTENTIAL_EXERCISE, presentation, referenceView, type Settings, undoAllowed } from "./core/rules";
import { elapsedMs, goTo, newProgress, pause, phase, poseState, type Progress, restartPose, restartStep, skipStep, start, tick } from "./core/session";
import { createId, type Sheet } from "./core/sheet";
import { MEDIA, type Medium, mediumFor } from "./core/brushes";
import { allSheets, allValues, askToPersist, getSheet, getValue, putSheet, setValue } from "./core/storage";
import { mountDrawing } from "./ui/drawing";
import { dayTitle, drawingFile, mountGallery, shareToPhotos } from "./ui/gallery";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ----- state -----

let progress: Progress = newProgress();
let settings: Settings = DEFAULT_SETTINGS;
let muybridge: MuybridgeData | null = null;
let deck: Deck | null = null;
let groups: GroupPoses = {};
let groupSheets: Record<string, string> = {};
/** Frames retired with Skip pose. */
let skipped: Skipped = {};
let dayPoses: DayPoses | null = null;
let dayPosesKey = "";
let fetchStatus = "";
/** The sheet strokes go to, and the block it belongs to. */
let sheet: Sheet | null = null;
let sheetContext = "";
let shownImage = "";
let saveTimer = 0;
let wakeLock: { release(): Promise<void> } | null = null;

const drawing = mountDrawing($("drawingPane"), {
  sheetForStroke(aspect, widthPx) {
    if (phase(progress) !== "running") return null;
    const step = currentDrawStep();
    if (!step) return null;
    const context = contextFor();
    if (!sheet || sheetContext !== context) {
      sheet = {
        id: createId(),
        day: dayKey(progress.plan, progress.place),
        occ: progress.place.occ,
        dayIndex: progress.place.day,
        step: progress.place.step,
        ex: step.ex,
        ...(step.group ? { group: step.group } : {}),
        aspect,
        widthPx,
        medium: mediumFor(step).id,
        created: Date.now(),
        updated: Date.now(),
        strokes: [],
        poses: [],
        source: presentation(step, settings).kind,
      };
      sheetContext = context;
      if (step.group) {
        groupSheets[groupKey(progress.plan[progress.place.occ], step.group)] = sheet.id;
        void setValue("groupSheets", groupSheets);
      }
    }
    const pose = currentPose();
    const last = sheet.poses[sheet.poses.length - 1];
    if (pose && (!last || last.plate !== pose.plate || last.frame !== pose.frame)) sheet.poses = [...sheet.poses, pose];
    return sheet;
  },
  strokeAdded(target) {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void putSheet(target), 1200);
    renderButtons();
  },
  refused() {
    const p = phase(progress);
    toast(p === "rest" ? "Rest: press Start for the next block" : p === "complete" ? "The course is complete" : "Press Start to begin");
  },
});

const gallery = mountGallery({
  muybridge: () => muybridge,
  hand: () => settings.hand,
  toast,
  sheetDeleted(id) {
    if (sheet?.id === id) { sheet = null; sheetContext = ""; drawing.setSheet(null, currentMedium()); }
  },
});

// ----- helpers -----

function toast(text: string): void {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  window.clearTimeout(Number(el.dataset.timer));
  el.dataset.timer = String(window.setTimeout(() => { el.hidden = true; }, 2600));
}

/** The current block's medium (pencil while resting or between days). */
function currentMedium(): Medium {
  const step = currentDrawStep();
  return step ? mediumFor(step) : MEDIA["pencil-gesture"];
}

function currentDrawStep(): DrawStep | null {
  if (progress.complete) return null;
  const step = stepAt(progress.plan, progress.place);
  return step.kind === "draw" ? step : null;
}

/** Strokes in the same block (or the same carried-on artwork) share a sheet until New sheet. */
function contextFor(): string {
  const step = currentDrawStep();
  if (step?.group) return `group:${groupKey(progress.plan[progress.place.occ], step.group)}`;
  return `${dayKey(progress.plan, progress.place)}:${progress.place.step}`;
}

function currentPose(): FrameRef | null {
  const step = currentDrawStep();
  if (!step || !dayPoses || presentation(step, settings).kind !== "muybridge") return null;
  const poses = dayPoses.steps[progress.place.step];
  if (!poses?.length) return null;
  return poses[poseState(step, elapsedMs(progress, Date.now())).index] ?? poses[poses.length - 1];
}

function clock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function minutes(seconds: number): string {
  return seconds >= 3600 && seconds % 3600 === 0 ? `${seconds / 3600} h` : `${Math.round(seconds / 60)} min`;
}

function placeTitle(occ = progress.place.occ, day = progress.place.day): string {
  const o = progress.plan[occ];
  return `Schedule ${o.s}${o.r ? ` (repeat ${o.r})` : ""} · Day ${scheduleOf(o.s).days[day].label}`;
}

function countText(step: DrawStep): string {
  const durations = poseDurations(step);
  if (durations.length <= 1) return "";
  const label = (seconds: number) => (seconds % 60 === 0 ? `${seconds / 60} min` : `${Math.round(seconds / 6) / 10} min`);
  // Runs of equal lengths: "× 25 · 1 min each", or "10 × 1 min, then 4 × 5 min".
  const runs: [number, number][] = [];
  for (const d of durations) {
    const last = runs[runs.length - 1];
    if (last && last[0] === d) last[1] += 1; else runs.push([d, 1]);
  }
  if (runs.length === 1) return ` × ${durations.length} · ${label(runs[0][0])} each`;
  return ` · ${runs.map(([d, n]) => `${n} × ${label(d)}`).join(", then ")}`;
}

function blockList(list: HTMLOListElement, occ: number, day: number, current: number | null): void {
  const steps = dayAt(progress.plan, { occ, day, step: 0 }).steps;
  list.replaceChildren(...steps.map((step, i) => {
    const li = document.createElement("li");
    if (step.kind === "rest") li.classList.add("rest");
    if (current !== null && i === current) li.classList.add("now");
    if (current !== null && i < current) li.classList.add("done");
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = minutes(activeSeconds(step));
    const name = document.createElement("span");
    name.textContent = step.kind === "rest" ? "Rest" : `${stepName(step)}${countText(step)}${step.note ? ` · ${step.note}` : ""}`;
    li.append(t, name);
    return li;
  }));
}

// ----- persistence -----

function saveProgress(): void {
  void setValue("progress", { ...progress, seen: Date.now() });
}

// ----- Save to Photos when a sheet is set aside -----

/** The sheet last set aside (New sheet, or its block ending) and its picture, while the offer shows. */
let offered: { sheet: Sheet; file: File | null } | null = null;
let offerTimer = 0;
/** How long the offer stays up; drawing carries on underneath it. */
const OFFER_MS = 30_000;

function hideOffer(): void {
  offered = null;
  window.clearTimeout(offerTimer);
  $("saveOffer").hidden = true;
}

function offerSave(set: Sheet): void {
  if (!set.strokes.length) return;
  const offer = { sheet: set, file: null as File | null };
  offered = offer;
  const button = $<HTMLButtonElement>("saveOfferButton");
  button.disabled = true;
  button.textContent = "Preparing last sheet…";
  $("saveOffer").hidden = false;
  window.clearTimeout(offerTimer);
  offerTimer = window.setTimeout(hideOffer, OFFER_MS);
  // Made ahead, so the tap can open the share sheet at once (Safari needs the tap).
  window.setTimeout(() => {
    void drawingFile(set).then((file) => {
      if (offered !== offer) return;
      offer.file = file;
      button.disabled = false;
      button.textContent = "Save last sheet to Photos";
    });
  }, 50);
}

$("saveOfferButton").addEventListener("click", () => {
  if (!offered?.file) return;
  const set = offered.sheet;
  if (!shareToPhotos(offered.file, toast)) void gallery.openSheet(set);
  hideOffer();
});
$("saveOfferClose").addEventListener("click", hideOffer);

function flushSheet(): void {
  window.clearTimeout(saveTimer);
  if (sheet && sheet.strokes.length) void putSheet(sheet);
}

// ----- poses -----

/** Deals today's poses if needed and fetches their images ahead. */
async function ensureDayPoses(): Promise<void> {
  if (!muybridge || progress.complete) return;
  const key = dayKey(progress.plan, progress.place);
  if (dayPosesKey !== key) {
    dayPoses = (await getValue<DayPoses>(`poses:${key}`)) ?? null;
    dayPosesKey = key;
  }
  deck ??= (await getValue<Deck>("deck")) ?? newDeck(muybridge);
  const result = assignPoses(muybridge, deck, groups, progress.plan, progress.place, settings, dayPoses ?? undefined, Math.random, COURSE, skipped);
  const changed = JSON.stringify(result.poses) !== JSON.stringify(dayPoses);
  dayPoses = result.poses;
  if (changed) {
    deck = result.deck;
    groups = result.groups;
    await Promise.all([setValue(`poses:${key}`, dayPoses), setValue("deck", deck), setValue("groups", groups)]);
  }
  const data = muybridge;
  // Potential gesture also shows each pose's later frame, so fetch those too.
  const refs = [...allPoses(dayPoses)];
  dayAt(progress.plan, progress.place).steps.forEach((st, i) => {
    if (st.kind === "draw" && st.ex.includes(POTENTIAL_EXERCISE)) for (const r of dayPoses?.steps[i] ?? []) { const later = laterFrame(data, r); if (later) refs.push(later); }
  });
  const urls = [...new Set(refs.map((ref) => frameUrl(data, ref)))];
  if (urls.length === 0) { fetchStatus = ""; render(); return; }
  fetchStatus = `Fetching poses: 0 of ${urls.length}`;
  render();
  const failed = await prefetch(urls, (done, total) => {
    fetchStatus = `Fetching poses: ${done} of ${total}`;
    renderCard();
  });
  fetchStatus = failed ? `${failed} of ${urls.length} poses could not be fetched; they will be tried again when shown.` : `All ${urls.length} poses are on the iPad, so today works offline.`;
  render();
  void pruneFrames([...urls, ...Object.values(groups).map((ref) => frameUrl(data, ref))]);
}

async function showReference(): Promise<void> {
  const img = $<HTMLImageElement>("referenceImage");
  const step = currentDrawStep();
  const pose = currentPose();
  if (!step || !pose || !muybridge) { img.removeAttribute("src"); shownImage = ""; return; }
  const state = poseState(step, elapsedMs(progress, Date.now()));
  const length = poseDurations(step)[state.index] * 1000;
  // Once a block has begun the views hold while paused too, so a pause is no second look.
  const view = phase(progress) === "ready" ? { kind: "pose" as const } : referenceView(step, length - state.poseLeftMs, length);
  const ref = view.kind === "next" ? laterFrame(muybridge, pose) ?? pose : pose;
  img.style.visibility = view.kind === "hidden" ? "hidden" : "visible";
  $("referenceMessage").textContent = view.kind === "pose" ? "" : view.message;
  $("referenceMessage").classList.toggle("over-image", view.kind === "next");
  const url = frameUrl(muybridge, ref);
  if (url === shownImage) return;
  shownImage = url;
  $("referenceCaption").textContent = frameCaption(muybridge, ref);
  try {
    const objectUrl = await frameObjectUrl(url);
    if (shownImage === url) img.src = objectUrl;
  } catch {
    if (shownImage === url) { img.removeAttribute("src"); $("referenceMessage").textContent = "This pose could not be loaded. Check the connection."; }
  }
}

// ----- the block in hand -----

/** Called whenever the place in the course may have changed. */
async function enterStep(): Promise<void> {
  const context = progress.complete ? "" : contextFor();
  if (context !== sheetContext) {
    flushSheet();
    if (sheet) offerSave(sheet);
    sheet = null;
    sheetContext = "";
    const step = currentDrawStep();
    if (step?.group) {
      const id = groupSheets[groupKey(progress.plan[progress.place.occ], step.group)];
      const stored = id ? await getSheet(id) : undefined;
      if (stored) { sheet = stored; sheetContext = context; }
    }
    drawing.setSheet(sheet, currentMedium());
  }
  if (dayPosesKey !== (progress.complete ? "" : dayKey(progress.plan, progress.place))) await ensureDayPoses();
  render();
}

// ----- rendering -----

function renderButtons(): void {
  const p = phase(progress);
  const step = currentDrawStep();
  const running = p === "running";
  const startButton = $<HTMLButtonElement>("startButton");
  startButton.textContent = running ? "Pause" : p === "paused" ? "Resume" : "Start";
  startButton.disabled = p === "complete";
  const blind = !!step && isBlind(step);
  $("peekButton").hidden = !(blind && running);
  $("skipPoseButton").hidden = !(currentPose() && (running || p === "paused"));
  $("undoButton").hidden = !undoAllowed(progress.plan, progress.place, settings);
  $<HTMLButtonElement>("undoButton").disabled = !sheet || sheet.strokes.length === 0;
  $<HTMLButtonElement>("newSheetButton").disabled = !sheet || sheet.strokes.length === 0;
  $("blindNote").hidden = !(blind && running);
  drawing.setBlind(blind);
}

function renderCard(): void {
  const p = phase(progress);
  const card = $("card");
  card.hidden = p === "running";
  if (p === "running") return;
  const kicker = $("cardKicker");
  const titleEl = $("cardTitle");
  const note = $("cardNote");
  const list = $<HTMLOListElement>("cardBlocks");
  const button = $<HTMLButtonElement>("cardStart");
  button.hidden = false;
  if (p === "complete") {
    kicker.textContent = "The Natural Way to Draw";
    titleEl.textContent = "Course complete";
    list.replaceChildren();
    note.textContent = "Every schedule is done. Course → Go to a day to work any of them again.";
    button.hidden = true;
    return;
  }
  const schedule = scheduleOf(progress.plan[progress.place.occ].s);
  const lines: string[] = [];
  if (p === "rest") {
    kicker.textContent = placeTitle();
    titleEl.textContent = "Rest";
    button.textContent = "Start next block";
  } else if (p === "paused") {
    kicker.textContent = `Paused · ${placeTitle()}`;
    titleEl.textContent = stepName(stepAt(progress.plan, progress.place));
    button.textContent = "Resume";
  } else {
    kicker.textContent = progress.finished ? `Finished ${dayTitle(progress.finished)}. Next: ${placeTitle()}` : placeTitle();
    titleEl.textContent = schedule.section;
    button.textContent = "Start";
    if (progress.place.day === 0 && schedule.homework.length) lines.push(`On your own this week: ${schedule.homework.join("; ")}.`);
  }
  blockList(list, progress.place.occ, progress.place.day, p === "ready" ? null : progress.place.step);
  if (fetchStatus) lines.push(fetchStatus);
  note.textContent = lines.join("\n");
}

function render(): void {
  const p = phase(progress);
  const step = currentDrawStep();
  const where = $("where");
  where.textContent = p === "complete" ? "Course complete" : `${placeTitle()} · Block ${progress.place.step + 1} of ${dayAt(progress.plan, progress.place).steps.length}`;
  const stage = $("stage");
  stage.dataset.hand = settings.hand;
  const kind = step ? presentation(step, settings).kind : "own";
  stage.dataset.reference = kind === "muybridge" ? "on" : "off";
  $("hudName").textContent = p === "complete" ? "" : step ? `${stepName(step)}${kind === "life" ? " · real life" : kind === "own" ? " · your own reference" : ""}` : "Rest";
  if (step) {
    const elapsed = elapsedMs(progress, Date.now());
    const pose = poseState(step, elapsed);
    const many = poseCount(step) > 1;
    $("hudPose").textContent = many ? `Pose ${pose.index + 1} of ${pose.count}` : "";
    $("hudTime").textContent = clock(many ? pose.poseLeftMs : pose.stepLeftMs);
    $("hudBlock").textContent = many ? `Block ${clock(pose.stepLeftMs)} left` : "left";
  } else {
    $("hudPose").textContent = "";
    $("hudTime").textContent = "";
    $("hudBlock").textContent = "";
  }
  renderButtons();
  renderCard();
  void showReference();
}

// ----- controls -----

async function keepAwake(on: boolean): Promise<void> {
  try {
    if (on && !wakeLock && "wakeLock" in navigator) {
      wakeLock = await (navigator as Navigator & { wakeLock: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock.request("screen");
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
}

async function toggleStart(): Promise<void> {
  const now = Date.now();
  if (phase(progress) === "running") {
    progress = pause(progress, now);
    flushSheet();
  } else {
    progress = start(progress, now);
    void askToPersist();
  }
  void keepAwake(phase(progress) === "running");
  saveProgress();
  await enterStep();
}

function loop(): void {
  if (progress.since !== null) {
    const before = JSON.stringify(progress.place);
    progress = tick(progress, Date.now());
    if (JSON.stringify(progress.place) !== before || progress.since === null) {
      saveProgress();
      if (progress.since === null) void keepAwake(false);
      void enterStep();
    }
    render();
  }
}

$("startButton").addEventListener("click", () => void toggleStart());
$("cardStart").addEventListener("click", () => void toggleStart());
$("peekButton").addEventListener("click", () => drawing.peek(PEEK_MS));
$("skipPoseButton").addEventListener("click", async () => {
  const step = currentDrawStep();
  const pose = currentPose();
  if (!step || !pose || !muybridge || !dayPoses || !deck) return;
  skipped = skipFrame(muybridge, skipped, pose);
  const dealt = dealPoses(muybridge, deck, 1, Math.random, skipped);
  const replacement = dealt.poses[0];
  if (!replacement) return;
  deck = dealt.deck;
  const index = poseState(step, elapsedMs(progress, Date.now())).index;
  const list = [...(dayPoses.steps[progress.place.step] ?? [])];
  list[Math.min(index, list.length - 1)] = replacement;
  dayPoses = { steps: { ...dayPoses.steps, [progress.place.step]: list } };
  if (step.group) groups = { ...groups, [groupKey(progress.plan[progress.place.occ], step.group)]: replacement };
  progress = restartPose(progress, Date.now(), step);
  saveProgress();
  await Promise.all([
    setValue("skippedFrames", skipped),
    setValue("deck", deck),
    setValue("groups", groups),
    setValue(`poses:${dayPosesKey}`, dayPoses),
  ]);
  render();
  toast("Skipped");
});

$("newSheetButton").addEventListener("click", () => {
  flushSheet();
  if (sheet) offerSave(sheet);
  sheet = null;
  sheetContext = "";
  drawing.setSheet(null, currentMedium());
  renderButtons();
  toast("New sheet");
});
$("undoButton").addEventListener("click", () => {
  if (!sheet || !sheet.strokes.length) return;
  sheet.strokes = sheet.strokes.slice(0, -1);
  sheet.updated = Date.now();
  void putSheet(sheet);
  drawing.redraw();
  renderButtons();
});
$("galleryButton").addEventListener("click", () => { flushSheet(); void gallery.show(); });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && progress.since !== null) {
    progress = pause(progress, Date.now());
    flushSheet();
    saveProgress();
    void keepAwake(false);
    render();
  }
});
window.addEventListener("pagehide", () => { flushSheet(); if (progress.since !== null) { progress = pause(progress, Date.now()); saveProgress(); } });

// ----- Course dialog -----

const courseDialog = $<HTMLDialogElement>("courseDialog");
const occSelect = $<HTMLSelectElement>("occurrenceSelect");
const daySelect = $<HTMLSelectElement>("daySelect");

function fillCourseDialog(): void {
  occSelect.replaceChildren(...progress.plan.map((o, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = `Schedule ${o.s}${o.r ? ` (repeat ${o.r})` : ""} · ${scheduleOf(o.s).section}`;
    return option;
  }));
  occSelect.value = String(progress.place.occ);
  daySelect.value = String(progress.place.day);
  previewDay();
}

function previewDay(): void {
  const occ = Number(occSelect.value);
  blockList($<HTMLOListElement>("dayPreview"), occ, Number(daySelect.value), null);
  const s = scheduleOf(progress.plan[occ].s);
  const times = progress.plan.filter((o) => o.s === s.n).length;
  const advice: Record<string, string> = {
    repeat: "The book asks for this schedule to be repeated.",
    optional: "The book says repeating this schedule helps.",
    progressive: "The book says to repeat this schedule, gradually adding Exercises 62–64.",
  };
  $("repeatNote").textContent = `${advice[s.repeat] ?? "The book does not ask for a repeat."} In your course ${times === 1 ? "once" : `${times} times`}.`;
}

occSelect.addEventListener("change", previewDay);
daySelect.addEventListener("change", previewDay);
$("courseButton").addEventListener("click", () => { fillCourseDialog(); courseDialog.showModal(); });
$("restartStepButton").addEventListener("click", () => {
  progress = restartStep(progress, Date.now());
  saveProgress();
  courseDialog.close();
  void enterStep();
});
$("skipStepButton").addEventListener("click", () => {
  progress = skipStep(progress, Date.now());
  saveProgress();
  courseDialog.close();
  void enterStep();
});
$("goToDayButton").addEventListener("click", () => {
  const target = { occ: Number(occSelect.value), day: Number(daySelect.value), step: 0 };
  if (phase(progress) !== "ready" && !confirm(`Leave ${placeTitle()} and go to ${placeTitle(target.occ, target.day)}? Your sheets are kept.`)) return;
  flushSheet();
  progress = goTo(progress, target);
  void keepAwake(false);
  saveProgress();
  courseDialog.close();
  void enterStep();
});
$("addRepeatButton").addEventListener("click", () => {
  const occ = Number(occSelect.value);
  const plan = addRepeat(progress.plan, occ);
  const inserted = plan.findIndex((o, i) => o.s !== progress.plan[i]?.s || o.r !== progress.plan[i]?.r);
  const place = { ...progress.place, occ: progress.place.occ >= inserted ? progress.place.occ + 1 : progress.place.occ };
  progress = { ...progress, plan, place };
  saveProgress();
  fillCourseDialog();
  occSelect.value = String(inserted);
  previewDay();
  toast(`Added ${placeTitle(inserted, 0).replace(" · Day A", "")}`);
});

// ----- Settings dialog -----

const settingsDialog = $<HTMLDialogElement>("settingsDialog");

function saveSettings(): void {
  void setValue("settings", settings);
  fillSettings();
  void ensureDayPoses();
  render();
}

function segmented(selected: string, options: [string, string][], onPick: (value: string) => void): HTMLElement {
  const group = document.createElement("div");
  group.className = "segmented";
  for (const [value, label] of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(value === selected));
    b.addEventListener("click", () => onPick(value));
    group.append(b);
  }
  return group;
}

function fillSettings(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>("#handSetting button")) b.setAttribute("aria-pressed", String(b.dataset.hand === settings.hand));
  for (const b of document.querySelectorAll<HTMLButtonElement>("#undoSetting button")) b.setAttribute("aria-pressed", String((b.dataset.undo === "on") === settings.earlyUndo));
  const used = new Set<number>();
  for (const s of COURSE.schedules) for (const d of s.days) for (const st of d.steps) if (st.kind === "draw") st.ex.forEach((id) => used.add(id));
  $("sourceList").replaceChildren(...[...used].sort((a, b) => a - b).map((id) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = `${id}. ${exerciseName(id)}`;
    li.append(name, segmented(settings.source[String(id)] ?? "app", [["app", "In app"], ["life", "Real life"]], (value) => {
      const source = { ...settings.source };
      if (value === "life") source[String(id)] = "life"; else delete source[String(id)];
      settings = { ...settings, source };
      saveSettings();
    }));
    return li;
  }));
  const frames = Object.values(skipped).reduce((sum, list) => sum + list.length, 0);
  $("skippedNote").textContent = frames
    ? `${frames} frame${frames === 1 ? "" : "s"} from ${Object.keys(skipped).length} plate${Object.keys(skipped).length === 1 ? "" : "s"} retired with Skip pose.`
    : "Skip pose retires a frame and its near neighbours from that camera; a second skip from the same camera retires that view. None yet.";
  $<HTMLButtonElement>("restoreSkippedButton").disabled = frames === 0;
  $("credit").textContent = muybridge ? `Poses: ${muybridge.source}.` : "";
}

$("restoreSkippedButton").addEventListener("click", () => {
  skipped = {};
  void setValue("skippedFrames", skipped);
  fillSettings();
  toast("Skipped poses are back in the deck");
});

for (const b of document.querySelectorAll<HTMLButtonElement>("#handSetting button")) {
  b.addEventListener("click", () => { settings = { ...settings, hand: b.dataset.hand === "right" ? "right" : "left" }; saveSettings(); });
}
for (const b of document.querySelectorAll<HTMLButtonElement>("#undoSetting button")) {
  b.addEventListener("click", () => { settings = { ...settings, earlyUndo: b.dataset.undo === "on" }; saveSettings(); });
}
$("settingsButton").addEventListener("click", async () => {
  fillSettings();
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  $("storageNote").textContent = `Drawings are kept only on this iPad${persisted ? ", and Safari has agreed to keep them" : "; adding the app to the Home Screen helps Safari keep them"}.` +
    (estimate?.usage ? ` In use: ${(estimate.usage / 1024 / 1024).toFixed(1)} MB.` : "");
  settingsDialog.showModal();
});

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

$("exportButton").addEventListener("click", async () => {
  flushSheet();
  const values = await allValues();
  const sheets = (await allSheets()).map((s) => ({ ...s, strokes: s.strokes.map((st) => base64(new Uint8Array(st.buffer, st.byteOffset, st.byteLength))) }));
  const json = JSON.stringify({ app: "nicolaides", schema: 1, exported: new Date().toISOString(), strokeFormat: "Int16Array little-endian, base64; see src/core/sheet.ts", values, sheets });
  const file = new File([json], `nicolaides-${new Date().toISOString().slice(0, 10)}.json`, { type: "application/json" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file] }).catch(() => undefined);
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
  }
});

// ----- start-up -----

function watchAppHeight(): void {
  // In the Home Screen app iPadOS can keep the old height after a rotation (as in Circle Trainer).
  const sync = () => document.documentElement.style.setProperty("--app-height", `${Math.round(Math.min(window.innerHeight, window.visualViewport?.height ?? Infinity))}px`);
  window.addEventListener("resize", sync);
  window.visualViewport?.addEventListener("resize", sync);
  for (const delay of [0, 300, 800]) window.setTimeout(sync, delay);
}

async function startUp(): Promise<void> {
  watchAppHeight();
  const stored = await getValue<Progress & { seen?: number }>("progress");
  if (stored?.version === 1) {
    const { seen, ...rest } = stored;
    progress = rest;
    // Closed while running: stop the clock when the page was last seen.
    if (progress.since !== null) progress = pause(progress, Math.min(Date.now(), seen ?? Date.now()));
  }
  settings = { ...DEFAULT_SETTINGS, ...((await getValue<Settings>("settings")) ?? {}) };
  groups = (await getValue<GroupPoses>("groups")) ?? {};
  groupSheets = (await getValue<Record<string, string>>("groupSheets")) ?? {};
  // Whole-plate skips (before 0.1.1) did not record the frame, so they are let go.
  skipped = (await getValue<Skipped>("skippedFrames")) ?? {};
  render();
  try {
    muybridge = (await (await fetch("./data/muybridge.json")).json()) as MuybridgeData;
  } catch {
    toast("The Muybridge poses could not be loaded");
  }
  await enterStep();
  await ensureDayPoses();
  // Often enough for the one-second flash pose.
  window.setInterval(loop, 100);
  window.setInterval(() => { if (progress.since !== null) saveProgress(); }, 5000);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./service-worker.js").catch(() => undefined);
}

void startUp();
