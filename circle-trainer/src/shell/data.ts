import { EXERCISE_LABELS } from "../activities/drills";
import { duplicateStrokeIds, looseStrokes, oldLooseStrokeIds, pruneTrial, RAW_SAMPLE_DAYS, strokeIdsInTrials, trialSampleCount, trialsToPrune } from "../core/retention";
import { bestTrialsByExercise } from "../core/trophies";
import type { ExerciseType, ExportBundle, RawStroke, TrialRecord } from "../core/types";
import {
  clearStrokes,
  clearTrials,
  deleteStrokes,
  getPrunedTotals,
  getStrokes,
  getTrials,
  saveLastExport,
  savePrunedTotals,
  saveTrials,
} from "../storage";
import { resetSession } from "./modes";
import { activities, app, APP_VERSION, cssPxPerMm, DEFAULT_CSS_PX_PER_MM, getDeviceSnapshot, requiredElement, SCHEMA_VERSION, showToast } from "./state";
import { dayDoneBackup, doneBackup } from "./today";
import { createTrophyView } from "./trophyView";

/** Practice data (export, trimming, delete) and the Trophies sheet (moved from main.ts in 0.17.0). */

export const dataDialog = requiredElement<HTMLDialogElement>("#dataDialog");
const dataSummary = requiredElement<HTMLElement>("#dataSummary");
const dataRetention = requiredElement<HTMLElement>("#dataRetention");
const trophyDialog = requiredElement<HTMLDialogElement>("#trophyDialog");
const trophyIntro = requiredElement<HTMLElement>("#trophyIntro");
const trophyView = createTrophyView({
  grid: requiredElement<HTMLElement>("#trophyGrid"),
  detail: requiredElement<HTMLElement>("#trophyDetail"),
  detailTitle: requiredElement<HTMLElement>("#trophyDetailTitle"),
  detailScore: requiredElement<HTMLElement>("#trophyDetailScore"),
  detailMeta: requiredElement<HTMLElement>("#trophyDetailMeta"),
  detailMetrics: requiredElement<HTMLElement>("#trophyDetailMetrics"),
  detailCanvas: requiredElement<HTMLCanvasElement>("#trophyDetailCanvas"),
}, (trial) => trialCssPxPerMm(trial));

export function downloadJson(filename: string, value: unknown, compact = false): void {
  const blob = new Blob([compact ? JSON.stringify(value) : JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function dateStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function exportAllData(): Promise<void> {
  try {
    const [strokes, trials] = await Promise.all([getStrokes(), getTrials()]);
    const bundle: ExportBundle = {
      schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, exportedAt: Date.now(), calibration: app.calibration,
      // Each stroke once: trials hold their own, so only strokes with no trial are listed separately.
      selectedMode: app.selectedMode, correctionGateEnabled: app.correctionGateEnabled, device: getDeviceSnapshot(), strokes: looseStrokes(strokes, strokeIdsInTrials(trials)), trials,
      practiceTimeByDay: app.practiceClock.snapshot(Date.now()),
      copyTimeByDay: app.copyClock.snapshot(Date.now()),
      memoryTimeByDay: app.memoryClock.snapshot(Date.now()),
      finishedDays: app.finishedDays,
    };
    downloadJson(`circle-trainer-${dateStamp()}.json`, bundle, true);
    app.lastExportMs = bundle.exportedAt;
    void saveLastExport(bundle.exportedAt).catch(() => undefined);
    doneBackup.hidden = true;
    dayDoneBackup.hidden = true;
    showToast("JSON export created");
    await offerTrim(trials, strokes, bundle.exportedAt);
  } catch { showToast("Data export failed"); }
}

/** Removes the strokes store's spare copies of trial strokes (nothing is lost: each trial holds its own). */
function removeDuplicateStrokes(ids: readonly string[]): void {
  if (ids.length === 0) return;
  void deleteStrokes(ids).then(async () => {
    const totals = await getPrunedTotals();
    await savePrunedTotals({ ...totals, strokesDeleted: totals.strokesDeleted + ids.length });
  }).catch(() => undefined);
}

/** Startup: the saved counts, and (up to 0.15.2 strokes were stored twice) dropping the spare stroke copies. */
export function loadStoredCounts(strokes: readonly RawStroke[], trials: readonly TrialRecord[]): void {
  const inTrials = strokeIdsInTrials(trials);
  app.savedStrokeCount = looseStrokes(strokes, inTrials).length + inTrials.size;
  app.savedTrialCount = trials.length;
  removeDuplicateStrokes(duplicateStrokeIds(strokes, inTrials));
}

const TRIM_BATCH = 200;

/**
 * After an export: if any Pencil points are past RAW_SAMPLE_DAYS (and in that export), ask whether the file was
 * saved, and only then trim them (core/retention.ts). Scores and trial records stay. Trials are rewritten in batches,
 * each all-or-nothing, so an interruption leaves the rest for the next export.
 */
async function offerTrim(trials: readonly TrialRecord[], strokes: readonly RawStroke[], exportedAt: number): Promise<void> {
  const now = Date.now();
  const toPrune = trialsToPrune(trials, now, exportedAt);
  const looseOld = oldLooseStrokeIds(strokes, strokeIdsInTrials(trials), now, exportedAt);
  if (toPrune.length === 0 && looseOld.length === 0) return;
  const samples = toPrune.reduce((sum, trial) => sum + trialSampleCount(trial), 0);
  const ok = window.confirm(
    `Did the export file save? If it did, Circle Trainer can now remove the Pencil points of ${toPrune.length.toLocaleString()} `
    + `trial${toPrune.length === 1 ? "" : "s"} older than ${RAW_SAMPLE_DAYS} days to save space. Their scores and records stay, `
    + "and trophies keep their drawings. The exported file keeps everything.\n\nOK to trim now, Cancel to keep everything for now.",
  );
  if (!ok) return;
  try {
    let totals = await getPrunedTotals();
    for (let start = 0; start < toPrune.length; start += TRIM_BATCH) {
      const batch = toPrune.slice(start, start + TRIM_BATCH);
      await saveTrials(batch.map(pruneTrial));
      totals = { ...totals, trials: totals.trials + batch.length, samples: totals.samples + batch.reduce((sum, trial) => sum + trialSampleCount(trial), 0) };
      await savePrunedTotals(totals);
    }
    await deleteStrokes(looseOld);
    if (looseOld.length > 0) await savePrunedTotals({ ...totals, strokesDeleted: totals.strokesDeleted + looseOld.length });
    app.savedStrokeCount -= looseOld.length;
    showToast(`Trimmed ${samples.toLocaleString()} Pencil points`);
    if (dataDialog.open) void showDataDialog();
  } catch { showToast("Trimming stopped; nothing is lost, and it continues after the next export"); }
}

export async function showDataDialog(): Promise<void> {
  try {
    const trials = await getTrials();
    app.savedTrialCount = trials.length;
    const counts = Object.fromEntries(Object.keys(EXERCISE_LABELS).map((type) => [type, 0])) as Record<ExerciseType, number>;
    trials.forEach((trial) => { counts[trial.exerciseType] += 1; });
    dataSummary.textContent = trials.length === 0
      ? "No practice trials saved yet."
      : `${trials.length.toLocaleString()} trials saved · ${counts.LINE} lines · ${counts.ARC} arcs · ${counts.CIRCLE} circles · ${counts.ELLIPSE} ellipses · ${counts.S_CURVE} S curves · ${counts.BOX} boxes.`;
    const totals = await getPrunedTotals();
    const trimmed = totals.trials === 0
      ? "Nothing trimmed yet."
      : `Trimmed so far: Pencil points of ${totals.trials.toLocaleString()} trial${totals.trials === 1 ? "" : "s"} (${totals.samples.toLocaleString()} points).`;
    dataRetention.textContent = `Every trial and score is kept. Pencil points are kept for ${RAW_SAMPLE_DAYS} days, and for good for trophies; `
      + `older ones can be trimmed after you export (you are asked first). ${trimmed}`;
  } catch { dataSummary.textContent = "Saved data could not be read in this browser."; }
  if (!dataDialog.open) dataDialog.showModal();
}

/**
 * Trials store their calibration id but not its px/mm value. Use the current calibration when it is the one
 * the trial was drawn with, the default scale for uncalibrated trials, and otherwise the current scale as the
 * best available guess (only mm-sized targets such as circles depend on it).
 */
function trialCssPxPerMm(trial: TrialRecord): number {
  if (trial.calibrationId === null) return DEFAULT_CSS_PX_PER_MM;
  return cssPxPerMm();
}

async function showTrophyDialog(): Promise<void> {
  let trials: TrialRecord[] = [];
  try {
    trials = await getTrials();
    trophyIntro.textContent = "Your highest-scoring attempt at each exercise: your strokes in black, the ideal in dashed blue. Tap one to see it larger.";
  } catch {
    trophyIntro.textContent = "Saved trials could not be read in this browser.";
  }
  trophyDialog.showModal();
  trophyView.render(bestTrialsByExercise(trials));
}

async function deleteAllData(): Promise<void> {
  if (!window.confirm("Delete every saved stroke and trial from this browser? This cannot be undone.")) return;
  try {
    await Promise.all([clearStrokes(), clearTrials()]);
    app.savedStrokeCount = 0;
    app.savedTrialCount = 0;
    activities.drills.clearHistory();
    dataDialog.close();
    // In Copy or Memory the drills start afresh when it is left, so they are not reset behind it.
    if (app.studio === null) resetSession(app.selectedMode);
    showToast("All practice data deleted");
  } catch { showToast("Saved data could not be deleted"); }
}

export function wireData(): void {
  requiredElement<HTMLButtonElement>("#trophiesButton").addEventListener("click", () => void showTrophyDialog());
  requiredElement<HTMLButtonElement>("#trophyBackButton").addEventListener("click", () => trophyView.showGrid());
  requiredElement<HTMLButtonElement>("#exportDataButton").addEventListener("click", () => void exportAllData());
  requiredElement<HTMLButtonElement>("#deleteDataButton").addEventListener("click", () => void deleteAllData());
  for (const note of [doneBackup, dayDoneBackup]) note.querySelector("button")?.addEventListener("click", () => void exportAllData());
}
