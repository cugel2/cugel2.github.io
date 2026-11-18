import "./styles.css";

import { mountCopy } from "./activities/copy";
import { mountDrills } from "./activities/drills";
import type { ActivityHost } from "./activities/types";
import { DEFAULT_COPY_BUDGET_MIN, startupMode } from "./core/dailyFlow";
import { DEFAULT_DAILY_TICKS, isQueueDone, queueRemaining } from "./core/dailyQueue";
import { dayKey, PracticeClock } from "./core/timer";
import { DEFAULT_HANDEDNESS } from "./core/types";
import {
  getCalibration,
  getCopyBudget,
  getCopyTime,
  getCorrectionGateEnabled,
  getDailyQueue,
  getDailyTicks,
  getDayMarks,
  getFinishedDays,
  getHandedness,
  getLastExport,
  getPracticeMode,
  getPracticeTime,
  getStrokes,
  getTrials,
} from "./storage";
import { watchAppHeight } from "./shell/appHeight";
import { loadStoredCounts, showDataDialog, wireData } from "./shell/data";
import { diagnosticsDialog, renderDiagnostics, wireDiagnostics } from "./shell/diagnostics";
import { enterCopy, goToToday, readCopyActive, readModeDay, rememberCopyActive, resetSession, wireModes } from "./shell/modes";
import { applyHandedness, calibrationDialog, configureRuler, updateCorrectionGateButton, updateScaleStatus, wireSettings } from "./shell/settings";
import { activities, app, APP_VERSION, cssPxPerMm, FIRST_DRILL, requiredElement, setStatus, showToast, VALID_MODES } from "./shell/state";
import {
  checkDayRollover,
  copyCheckpoint,
  dayDoneTodayButton,
  doneCopyButton,
  lastSavedPracticeMs,
  persistPracticeTime,
  recordActivity,
  recordFinishedDay,
  todayForDrills,
  todayQueue,
  updatePracticeTime,
  wireToday,
} from "./shell/today";

/**
 * Bootstrap (0.17.0): mount the activities with what the shell lends them, wire the shell, load stored settings
 * and open the right mode. Everything else lives in src/shell/ (shared) and src/activities/ (Drills and Copy).
 */

function mountActivities(): void {
  const shared: ActivityHost = {
    cssPxPerMm,
    handedness: () => app.handedness,
    toast: showToast,
    setStatus,
    recordActivity,
  };
  activities.drills = mountDrills({
    ...shared,
    appVersion: APP_VERSION,
    calibrationId: () => app.calibration?.id ?? null,
    correctionGateEnabled: () => app.correctionGateEnabled,
    recordSaved: ({ trials, strokes }) => {
      app.savedTrialCount += trials;
      app.savedStrokeCount += strokes;
    },
    today: todayForDrills,
  });
  activities.copy = mountCopy({ ...shared, checkpoint: copyCheckpoint });
}

function wireShell(): void {
  wireModes();
  wireSettings();
  wireToday();
  wireData();
  wireDiagnostics();
  requiredElement<HTMLButtonElement>("#dataButton").addEventListener("click", () => { calibrationDialog.close(); void showDataDialog(); });
  doneCopyButton.addEventListener("click", () => { if (!activities.drills.isDrawing()) enterCopy(); });
  dayDoneTodayButton.addEventListener("click", goToToday);
  document.addEventListener("visibilitychange", () => {
    const visible = document.visibilityState === "visible";
    app.practiceClock.setVisible(visible, Date.now());
    app.copyClock.setVisible(visible && app.copyActive, Date.now());
    if (visible) checkDayRollover();
    if (!visible) persistPracticeTime();
    updatePracticeTime();
  });
  window.addEventListener("pagehide", persistPracticeTime);
  window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    updatePracticeTime();
    recordFinishedDay();
  }, 1000);
  // Saving on pagehide is not reliable (the write may not finish), so also save while time is accruing.
  window.setInterval(() => { if (app.practiceClock.todayTotalMs(Date.now()) !== lastSavedPracticeMs) persistPracticeTime(); }, 10_000);
}

async function initialize(): Promise<void> {
  watchAppHeight();
  mountActivities();
  wireShell();
  try {
    const [storedCalibration, storedMode, storedCorrectionGate, storedHandedness, storedPracticeTime, storedTicks, storedQueue, strokes, trials, storedCopyTime, storedCopyBudget, storedMarks, storedFinishedDays, storedLastExport] = await Promise.all([
      getCalibration(), getPracticeMode(), getCorrectionGateEnabled(), getHandedness(), getPracticeTime(), getDailyTicks(), getDailyQueue(), getStrokes(), getTrials(),
      getCopyTime(), getCopyBudget(), getDayMarks(), getFinishedDays(), getLastExport(),
    ]);
    app.copyClock = new PracticeClock(storedCopyTime ?? {}, false);
    app.copyBudgetMin = storedCopyBudget ?? DEFAULT_COPY_BUDGET_MIN;
    app.dayMarks = storedMarks;
    app.finishedDays = storedFinishedDays;
    app.finishedDaysLoaded = true;
    app.lastExportMs = storedLastExport;
    app.dailyTicks = storedTicks ?? [...DEFAULT_DAILY_TICKS];
    app.dailyQueue = storedQueue;
    app.practiceClock = new PracticeClock(storedPracticeTime ?? {}, document.visibilityState === "visible");
    app.calibration = storedCalibration;
    app.handedness = storedHandedness ?? DEFAULT_HANDEDNESS;
    app.correctionGateEnabled = storedCorrectionGate ?? false;
    app.selectedMode = storedMode && VALID_MODES.includes(storedMode) ? storedMode : FIRST_DRILL;
    // The Mixed modes left the menu in 0.15.0 (Today interleaves the drills); a stored one opens on Today.
    if (app.selectedMode === "MIXED_BLOCKED" || app.selectedMode === "MIXED_RANDOM") app.selectedMode = "TODAY";
    // Open on Today while today's queue has reps left, unless a free mode was picked earlier today.
    const queue = todayQueue();
    app.selectedMode = startupMode(app.selectedMode, readModeDay(), dayKey(Date.now()), queue.order.length > 0 && !isQueueDone(queue));
    loadStoredCounts(strokes, trials);
    activities.drills.loadHistory(trials);
  } catch { showToast("Local storage is unavailable; drawing still works"); }
  updateScaleStatus();
  updateCorrectionGateButton();
  applyHandedness();
  configureRuler();
  resetSession(app.selectedMode);
  // Copy reopens after a reload the same day; a new day opens on Today while it has reps left.
  const copyWasOpen = readCopyActive();
  const repsLeft = app.dailyQueue !== null && queueRemaining(app.dailyQueue) > 0;
  if (copyWasOpen === "today" || (copyWasOpen === "earlier" && !repsLeft)) enterCopy();
  else if (copyWasOpen === "earlier") rememberCopyActive(false);
  updatePracticeTime();
  if (new URLSearchParams(window.location.search).has("diagnostics") || window.location.hash === "#diagnostics") {
    renderDiagnostics();
    diagnosticsDialog.showModal();
  }
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => { void navigator.serviceWorker.register("./service-worker.js").catch(() => undefined); });
  }
}

void initialize();
