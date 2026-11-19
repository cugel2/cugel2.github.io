import { COPY_UNIT, todayParts as copyTodayParts } from "../activities/copy";
import { ALL_EXERCISE_TYPES, DAILY_COUNTS, EXERCISE_LABELS, todayParts as drillsTodayParts } from "../activities/drills";
import type { OffersToday } from "../activities/types";
import type { DrillsHost } from "../activities/types";
import { backupReminder } from "../core/backup";
import {
  addFinishedDay,
  copyCardAtCheckpoint,
  copyClockState,
  copyLeftMs,
  copyTimeText,
  dayFinished,
  drillMs,
  lastSevenDays,
  marksForToday,
  todayCard,
  type CopyCard,
  type DayInput,
} from "../core/dailyFlow";
import {
  advanceQueue,
  currentQueueExercise,
  ensureQueueForCounts,
  queueMinutesLeft,
  queueProgress,
  queueRemaining,
  retickQueue,
  type DailyQueueState,
} from "../core/dailyQueue";
import { planDay, planRepMinutes, timedMinutes, type DayPlan } from "../core/todayPlan";
import { dayKey, formatClock, formatMinutes } from "../core/timer";
import type { ExerciseType } from "../core/types";
import { saveCopyBudget, saveCopyTime, saveDailyQueue, saveDailyTicks, saveDayMarks, saveFinishedDays, saveMemoryTime, savePracticeTime } from "../storage";
import { activities, app, requiredElement, setStatus, showToast } from "./state";

/**
 * Today (the daily queue), the daily flow (drills, then a timed stretch of Copy, then done), the practice-time
 * display, and the Today side of the drills host (moved from main.ts in 0.17.0).
 */

const practiceTime = requiredElement<HTMLElement>("#practiceTime");
export const doneCard = requiredElement<HTMLElement>("#doneCard");
const doneTitle = requiredElement<HTMLElement>("#doneTitle");
const doneDetail = requiredElement<HTMLElement>("#doneDetail");
const doneNote = requiredElement<HTMLElement>("#doneNote");
const doneWeekDots = requiredElement<HTMLElement>("#doneWeekDots");
export const doneSettingsButton = requiredElement<HTMLButtonElement>("#doneSettingsButton");
export const doneCopyButton = requiredElement<HTMLButtonElement>("#doneCopyButton");
export const doneFinishButton = requiredElement<HTMLButtonElement>("#doneFinishButton");
const copyBudgetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#copyBudgetSetting button[data-copy-budget]"));
export const dayDoneDialog = requiredElement<HTMLDialogElement>("#dayDoneDialog");
const dayDoneTitle = requiredElement<HTMLElement>("#dayDoneTitle");
const dayDoneDetail = requiredElement<HTMLElement>("#dayDoneDetail");
const dayDoneWeekDots = requiredElement<HTMLElement>("#dayDoneWeekDots");
export const doneBackup = requiredElement<HTMLElement>("#doneBackup");
export const dayDoneBackup = requiredElement<HTMLElement>("#dayDoneBackup");
export const dayDoneTodayButton = requiredElement<HTMLButtonElement>("#dayDoneTodayButton");
const dailyTicksList = requiredElement<HTMLElement>("#dailyTicks");
const dailyEstimate = requiredElement<HTMLElement>("#dailyEstimate");
const hud = requiredElement<HTMLElement>(".hud");
const todayHud = requiredElement<HTMLElement>(".hud-today");
const todayProgress = requiredElement<HTMLElement>("#todayProgress");
const todayProgressFill = requiredElement<HTMLElement>("#todayProgressFill");
const todayLeft = requiredElement<HTMLElement>("#todayLeft");

/* ---------- practice time ---------- */

/** Session and today's practice time, refreshed every second for display only (counting uses timestamps). */
export function updatePracticeTime(): void {
  const now = Date.now();
  practiceTime.textContent = `${formatClock(app.practiceClock.sessionTotalMs(now))} · ${formatMinutes(app.practiceClock.todayTotalMs(now))} today`;
  if (app.studio === "COPY") activities.copy.setTime(copyTimeText(copyClockState(dayInput(now))) ?? practiceTime.textContent);
  // Memory is not part of Today yet, so it has no countdown: it shows the practice clock, as Copy does when Off.
  if (app.studio === "MEMORY") activities.memory.setTime(practiceTime.textContent);
}

export let lastSavedPracticeMs = -1;

export function persistPracticeTime(): void {
  const now = Date.now();
  lastSavedPracticeMs = app.practiceClock.todayTotalMs(now);
  void savePracticeTime(app.practiceClock.snapshot(now)).catch(() => undefined);
  void saveCopyTime(app.copyClock.snapshot(now)).catch(() => undefined);
  void saveMemoryTime(app.memoryClock.snapshot(now)).catch(() => undefined);
}

/** Pencil or finger activity: the practice clock, and Copy's or Memory's clock while that one is open. */
export function recordActivity(options: { save: boolean; show: boolean }): void {
  const now = Date.now();
  app.practiceClock.recordActivity(now);
  if (app.studio === "COPY") app.copyClock.recordActivity(now);
  if (app.studio === "MEMORY") app.memoryClock.recordActivity(now);
  if (options.save) persistPracticeTime();
  if (options.show) updatePracticeTime();
}

/* ---------- Today's plan and queue ---------- */

/**
 * The activities that offer Today something, in the order of the day: the drills' reps first, then Copy's time.
 * A new activity joins Today by offering its parts here (and a setting for them).
 */
const TODAY_OFFERS: readonly OffersToday[] = [drillsTodayParts, copyTodayParts];

/** Today as planned from the standing settings (core/todayPlan.ts). */
export function todayPlan(): DayPlan {
  const settings = { ticks: app.dailyTicks, minutes: { [COPY_UNIT]: app.copyBudgetMin } };
  return planDay(TODAY_OFFERS.flatMap((offer) => offer(settings)));
}

/** Today's queue, rebuilt (and saved) when the practice day has changed since it was made. */
export function todayQueue(): DailyQueueState {
  const next = ensureQueueForCounts(app.dailyQueue, todayPlan().reps, Date.now());
  if (next !== app.dailyQueue) {
    app.dailyQueue = next;
    void saveDailyQueue(next).catch(() => undefined);
  }
  return next;
}

function todayStatusText(queue: DailyQueueState): string {
  return `Today · ${queueRemaining(queue)} left · about ${queueMinutesLeft(queue)} min`;
}

/** In Today the bottom bar shows the day's progress instead of the per-session stats; free modes keep the stats. */
export function updateTodayHud(): void {
  const inToday = app.selectedMode === "TODAY" && app.dailyQueue !== null;
  hud.classList.toggle("today", inToday);
  todayHud.hidden = !inToday;
  if (!inToday || !app.dailyQueue) return;
  const progress = queueProgress(app.dailyQueue);
  todayProgressFill.style.width = `${(progress.fraction * 100).toFixed(1)}%`;
  todayProgress.setAttribute("aria-valuemax", String(progress.total));
  todayProgress.setAttribute("aria-valuenow", String(progress.done));
  todayLeft.textContent = progress.label;
}

/** Shown instead of a target when today's queue is finished or nothing is ticked. */
export function showDoneCard(queue: DailyQueueState = todayQueue()): void {
  const now = Date.now();
  const day = dayInput(now, queue);
  const card = todayCard(day) ?? "DONE";
  const totalMs = app.practiceClock.todayTotalMs(now);
  // Memory time is practice time but not drill time (Memory is not part of Today yet).
  const memoryMs = app.memoryClock.todayTotalMs(now);
  const drillsMs = drillMs(totalMs, day.copyMs + memoryMs);
  if (card === "NOTHING_TICKED") {
    doneTitle.textContent = "Nothing ticked for Today";
    doneDetail.textContent = "Choose which modes make up the daily queue.";
    doneNote.textContent = "Today's queue is built from the ticked modes.";
  } else if (card === "HANDOFF") {
    doneTitle.textContent = `Drills done · ${formatMinutes(drillsMs)}`;
    doneDetail.textContent = `${queue.order.length} reps. Next, a stretch of copying.`;
    doneNote.textContent = "Copy carries on where you left it.";
    doneCopyButton.textContent = `Start copy · ${Math.ceil(copyLeftMs(day) / 60_000)} min`;
  } else {
    doneTitle.textContent = `Done for today · ${formatMinutes(totalMs)}`;
    const parts = [`${queue.order.length} reps`];
    if (day.copyMs >= 60_000 || memoryMs >= 60_000) parts.push(`${formatMinutes(drillsMs)} drills`);
    if (day.copyMs >= 60_000) parts.push(`${formatMinutes(day.copyMs)} copying`);
    if (memoryMs >= 60_000) parts.push(`${formatMinutes(memoryMs)} memory`);
    doneDetail.textContent = parts.join(" · ");
    doneNote.textContent = "Pick any mode above for free practice. It doesn't count toward the queue; a new one starts at 4 am.";
  }
  recordFinishedDay(now);
  renderWeekDots(doneWeekDots, card === "DONE");
  renderBackupNote(doneBackup, card === "DONE");
  doneSettingsButton.hidden = card !== "NOTHING_TICKED";
  doneCopyButton.hidden = card !== "HANDOFF";
  doneFinishButton.hidden = card !== "HANDOFF";
  doneCard.hidden = false;
  setStatus(card === "NOTHING_TICKED" ? "Today · nothing ticked" : card === "HANDOFF" ? "Today · drills done ✓" : "Today · done ✓");
}

/** The Today side of the drills host. */
export const todayForDrills: DrillsHost["today"] = {
  next: () => currentQueueExercise(todayQueue()),
  repDone() {
    app.dailyQueue = advanceQueue(todayQueue());
    void saveDailyQueue(app.dailyQueue).catch(() => showToast("Today's progress could not be saved"));
    updateTodayHud();
  },
  scheduleContext(generationIndex) {
    const queue = app.dailyQueue;
    if (!queue) return null;
    return { mode: "TODAY" as const, sessionSeed: `daily:${queue.dayKey}`, sequenceIndex: queue.position, cycleIndex: 0, generationIndex };
  },
  status: () => (app.dailyQueue ? todayStatusText(app.dailyQueue) : null),
  repsLeft: () => (app.dailyQueue ? queueRemaining(app.dailyQueue) : null),
  updateHud: updateTodayHud,
  showDone: () => showDoneCard(),
  hideDone() { doneCard.hidden = true; },
};

/* ---------- Daily flow: drills, then a timed stretch of Copy ---------- */

/** Everything the day's cards and Copy's countdown are worked out from. */
export function dayInput(nowMs: number, queue: DailyQueueState = todayQueue()): DayInput {
  return {
    drillReps: queue.order.length,
    drillRepsLeft: queueRemaining(queue),
    copyMs: app.copyClock.todayTotalMs(nowMs),
    // The daily flow has one timed part so far, Copy, with its own clock. More timed parts (Gesture, Memory) will
    // need a clock and a handoff each: see TODO "One daily total, split by the app".
    copyBudgetMin: timedMinutes(todayPlan(), COPY_UNIT),
    marks: marksForToday(app.dayMarks, nowMs),
  };
}

/** Records today as finished once the flow is done (checked every second and when a Done card shows). */
export function recordFinishedDay(nowMs = Date.now()): void {
  if (!app.finishedDaysLoaded) return;
  // Everything unticked after some reps is a change of mind, not a finished day: ticking drills again must still
  // add them back today (retickQueue), so do not record the day as finished meanwhile.
  if (app.dailyTicks.length === 0 && (app.dailyQueue?.order.length ?? 0) > 0) return;
  const today = dayKey(nowMs);
  if (app.finishedDays.includes(today) || !dayFinished(dayInput(nowMs))) return;
  app.finishedDays = addFinishedDay(app.finishedDays, today);
  void saveFinishedDays(app.finishedDays).catch(() => undefined);
}

function renderWeekDots(container: HTMLElement, show: boolean): void {
  container.hidden = !show;
  if (!show) return;
  const dots = lastSevenDays(app.finishedDays, dayKey(Date.now()));
  container.replaceChildren(...dots.map((dot) => {
    const item = document.createElement("span");
    item.className = `week-dot${dot.finished ? " finished" : ""}${dot.isToday ? " today" : ""}`;
    item.title = `${dot.dayKey}${dot.finished ? " · finished" : ""}`;
    item.append(document.createElement("i"), Object.assign(document.createElement("small"), { textContent: dot.weekday }));
    return item;
  }));
  container.setAttribute("aria-label", `Finished on ${dots.filter((dot) => dot.finished).length} of the last seven days`);
}

/** "Last export N days ago" with an Export now button, only when a backup is due. */
function renderBackupNote(container: HTMLElement, show: boolean): void {
  const now = Date.now();
  const practiceDays = Object.values(app.practiceClock.snapshot(now)).filter((ms) => ms > 0).length;
  const text = show && app.lastExportMs !== undefined ? backupReminder(app.lastExportMs, practiceDays, now) : null;
  container.hidden = text === null;
  const label = container.querySelector("span");
  if (label && text) label.textContent = `${text} ·`;
}

export function setDayMark(mark: "handoffDeclined" | "doneCardShown"): void {
  app.dayMarks = { ...marksForToday(app.dayMarks, Date.now()), [mark]: true };
  void saveDayMarks(app.dayMarks).catch(() => undefined);
}

/** Compare, Save or New copy in Copy: once Copy time is up, say so, once a day. */
export function copyCheckpoint(): void {
  if (app.studio !== "COPY" || dayDoneDialog.open) return;
  const card = copyCardAtCheckpoint(dayInput(Date.now()));
  if (!card) return;
  setDayMark("doneCardShown");
  showDayDoneDialog(card);
  updatePracticeTime();
}

function showDayDoneDialog(card: CopyCard): void {
  const now = Date.now();
  const queue = todayQueue();
  const copyMs = app.copyClock.todayTotalMs(now);
  if (card === "DAY_DONE") {
    dayDoneTitle.textContent = `Done for today · ${formatMinutes(app.practiceClock.todayTotalMs(now))}`;
    dayDoneDetail.textContent = `${formatMinutes(copyMs)} copying today. Finish this one if you like; Copy works as usual from here.`;
  } else {
    dayDoneTitle.textContent = `Copy time's up · ${formatMinutes(copyMs)}`;
    dayDoneDetail.textContent = `Today's drills aren't done yet: ${queueRemaining(queue)} left · about ${queueMinutesLeft(queue)} min.`;
  }
  recordFinishedDay(now);
  renderWeekDots(dayDoneWeekDots, card === "DAY_DONE");
  renderBackupNote(dayDoneBackup, card === "DAY_DONE");
  dayDoneTodayButton.hidden = card !== "DRILLS_LEFT";
  dayDoneDialog.dataset.hand = app.handedness === "LEFT" ? "left" : "right";
  dayDoneDialog.showModal();
}

export function renderCopyBudget(): void {
  for (const button of copyBudgetButtons) button.setAttribute("aria-pressed", String(Number(button.dataset.copyBudget) === app.copyBudgetMin));
}

function setCopyBudget(minutes: number): void {
  app.copyBudgetMin = minutes;
  renderCopyBudget();
  void saveCopyBudget(minutes).catch(() => showToast("Copy time setting could not be saved"));
  if (app.studio === null && !doneCard.hidden) showDoneCard(todayQueue());
  updatePracticeTime();
}

/** The 4 am rollover while the page is open: start the new day's queue unless a trial is in progress. */
export function checkDayRollover(): void {
  if (app.selectedMode !== "TODAY" || !app.dailyQueue || app.dailyQueue.dayKey === dayKey(Date.now())) return;
  if (!activities.drills.isBusy()) activities.drills.newTrial();
}

export function renderDailyTicks(): void {
  dailyTicksList.replaceChildren(...ALL_EXERCISE_TYPES.map((type) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = app.dailyTicks.includes(type);
    input.addEventListener("change", () => void setDailyTick(type, input.checked));
    const name = document.createElement("span");
    name.textContent = EXERCISE_LABELS[type];
    const count = document.createElement("small");
    count.textContent = `${DAILY_COUNTS[type]}`;
    label.append(input, name, count);
    return label;
  }));
  dailyEstimate.textContent = app.dailyTicks.length === 0 ? "Nothing ticked: Today will be empty." : `About ${planRepMinutes(todayPlan())} min a day.`;
}

async function setDailyTick(type: ExerciseType, ticked: boolean): Promise<void> {
  const now = Date.now();
  // Is the day finished right now (as the screen shows it), before this change? Drills done and Copy used up,
  // declined or Off. Not when nothing was ticked: ticking drills after unticking them all adds them back.
  const finishedNow = app.dailyTicks.length > 0 && app.dailyQueue !== null && dayFinished(dayInput(now, app.dailyQueue));
  app.dailyTicks = ALL_EXERCISE_TYPES.filter((each) => (each === type ? ticked : app.dailyTicks.includes(each)));
  renderDailyTicks();
  void saveDailyTicks(app.dailyTicks).catch(() => showToast("Today's ticks could not be saved"));
  // A Today rep in progress (a stroke, or a box partly drawn) is kept: the new ticks apply from the next rep.
  const inToday = app.selectedMode === "TODAY" && app.studio === null;
  const midTrial = inToday && activities.drills.isBusy();
  const { queue, outcome } = retickQueue(app.dailyQueue, todayPlan().reps, now, midTrial, finishedNow);
  if (outcome === "FINISHED") {
    showToast("Today is done: applies from tomorrow");
    return;
  }
  app.dailyQueue = queue;
  void saveDailyQueue(queue).catch(() => undefined);
  if (inToday && !midTrial) activities.drills.newTrial();
  else updateTodayHud();
  const left = queueRemaining(queue);
  showToast(queue.order.length === 0
    ? "Today's queue is empty"
    : outcome === "REBUILT" ? `Today's queue updated · ${queue.order.length} reps` : `Today's queue updated · ${left === 0 ? "all done" : `${left} left`}`);
}

export function wireToday(): void {
  for (const button of copyBudgetButtons) button.addEventListener("click", () => setCopyBudget(Number(button.dataset.copyBudget)));
  doneFinishButton.addEventListener("click", () => { setDayMark("handoffDeclined"); showDoneCard(todayQueue()); });
}
