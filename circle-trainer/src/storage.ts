import { normalizeTicks, parseQueueState, type DailyQueueState } from "./core/dailyQueue";
import { parseLastExport } from "./core/backup";
import { parseCopyBudget, parseFinishedDays, parseMarks, type DayMarks } from "./core/dailyFlow";
import type { DailyTotals } from "./core/timer";
import type { ExerciseType, Handedness, LegacyLineTrialRecord, PhysicalCalibration, PracticeMode, RawStroke, TrialRecord } from "./core/types";

const DB_NAME = "circle-trainer";
const DB_VERSION = 2;
const STROKES = "strokes";
const TRIALS = "trials";
const SETTINGS = "settings";
const CALIBRATION_KEY = "physical-calibration";
const PRACTICE_MODE_KEY = "practice-mode";
const CORRECTION_GATE_KEY = "correction-gate-enabled";
const HANDEDNESS_KEY = "handedness";
const PRACTICE_TIME_KEY = "practice-time-by-day";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STROKES)) {
        database.createObjectStore(STROKES, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(SETTINGS)) {
        database.createObjectStore(SETTINGS);
      }
      if (!database.objectStoreNames.contains(TRIALS)) {
        database.createObjectStore(TRIALS, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local storage"));
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local storage transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local storage transaction was cancelled"));
  });
}

export async function saveStroke(stroke: RawStroke): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STROKES, "readwrite");
  transaction.objectStore(STROKES).put(stroke);
  await waitForTransaction(transaction);
  database.close();
}

export async function getStrokes(): Promise<RawStroke[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STROKES, "readonly");
  const request = transaction.objectStore(STROKES).getAll();
  const strokes = await new Promise<RawStroke[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as RawStroke[]);
    request.onerror = () => reject(request.error ?? new Error("Could not read saved strokes"));
  });
  database.close();
  return strokes.sort((a, b) => a.startedAtEpochMs - b.startedAtEpochMs);
}

export async function clearStrokes(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STROKES, "readwrite");
  transaction.objectStore(STROKES).clear();
  await waitForTransaction(transaction);
  database.close();
}

export async function saveTrial(trial: TrialRecord): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(TRIALS, "readwrite");
  transaction.objectStore(TRIALS).put(trial);
  await waitForTransaction(transaction);
  database.close();
}

/** Replace several trials in one transaction (all or nothing). */
export async function saveTrials(trials: readonly TrialRecord[]): Promise<void> {
  if (trials.length === 0) return;
  const database = await openDatabase();
  const transaction = database.transaction(TRIALS, "readwrite");
  const store = transaction.objectStore(TRIALS);
  for (const trial of trials) store.put(trial);
  await waitForTransaction(transaction);
  database.close();
}

/** Delete strokes by id in one transaction (all or nothing). */
export async function deleteStrokes(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const database = await openDatabase();
  const transaction = database.transaction(STROKES, "readwrite");
  const store = transaction.objectStore(STROKES);
  for (const id of ids) store.delete(id);
  await waitForTransaction(transaction);
  database.close();
}

export function normalizeStoredTrial(trial: TrialRecord | LegacyLineTrialRecord, index: number): TrialRecord {
  if ("exerciseType" in trial) return { ...trial, correctionGateEnabled: trial.correctionGateEnabled ?? true };
  return {
    ...trial,
    exerciseType: "LINE",
    practiceMode: "LINE",
    correctionGateEnabled: true,
    schedule: {
      mode: "LINE",
      sessionSeed: "legacy-line-session",
      sequenceIndex: index,
      cycleIndex: 0,
    },
  };
}

export async function getTrials(): Promise<TrialRecord[]> {
  const database = await openDatabase();
  const request = database.transaction(TRIALS, "readonly").objectStore(TRIALS).getAll();
  const trials = await new Promise<Array<TrialRecord | LegacyLineTrialRecord>>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as Array<TrialRecord | LegacyLineTrialRecord>);
    request.onerror = () => reject(request.error ?? new Error("Could not read saved trials"));
  });
  database.close();
  return trials.sort((a, b) => a.createdAtEpochMs - b.createdAtEpochMs).map(normalizeStoredTrial);
}

export async function clearTrials(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(TRIALS, "readwrite");
  transaction.objectStore(TRIALS).clear();
  await waitForTransaction(transaction);
  database.close();
}

export async function saveCalibration(calibration: PhysicalCalibration): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(SETTINGS, "readwrite");
  transaction.objectStore(SETTINGS).put(calibration, CALIBRATION_KEY);
  await waitForTransaction(transaction);
  database.close();
}

export async function getCalibration(): Promise<PhysicalCalibration | null> {
  const database = await openDatabase();
  const transaction = database.transaction(SETTINGS, "readonly");
  const request = transaction.objectStore(SETTINGS).get(CALIBRATION_KEY);
  const calibration = await new Promise<PhysicalCalibration | null>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as PhysicalCalibration | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not read calibration"));
  });
  database.close();
  return calibration;
}

export async function savePracticeMode(mode: PracticeMode): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(SETTINGS, "readwrite");
  transaction.objectStore(SETTINGS).put(mode, PRACTICE_MODE_KEY);
  await waitForTransaction(transaction);
  database.close();
}

export async function getPracticeMode(): Promise<PracticeMode | null> {
  const database = await openDatabase();
  const request = database.transaction(SETTINGS, "readonly").objectStore(SETTINGS).get(PRACTICE_MODE_KEY);
  const mode = await new Promise<PracticeMode | null>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as PracticeMode | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not read practice mode"));
  });
  database.close();
  return mode;
}

export async function saveCorrectionGateEnabled(enabled: boolean): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(SETTINGS, "readwrite");
  transaction.objectStore(SETTINGS).put(enabled, CORRECTION_GATE_KEY);
  await waitForTransaction(transaction);
  database.close();
}

export async function getCorrectionGateEnabled(): Promise<boolean | null> {
  const database = await openDatabase();
  const request = database.transaction(SETTINGS, "readonly").objectStore(SETTINGS).get(CORRECTION_GATE_KEY);
  const enabled = await new Promise<boolean | null>((resolve, reject) => {
    request.onsuccess = () => resolve(typeof request.result === "boolean" ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error("Could not read correction gate setting"));
  });
  database.close();
  return enabled;
}

export async function saveHandedness(handedness: Handedness): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(SETTINGS, "readwrite");
  transaction.objectStore(SETTINGS).put(handedness, HANDEDNESS_KEY);
  await waitForTransaction(transaction);
  database.close();
}

export async function getHandedness(): Promise<Handedness | null> {
  const database = await openDatabase();
  const request = database.transaction(SETTINGS, "readonly").objectStore(SETTINGS).get(HANDEDNESS_KEY);
  const handedness = await new Promise<Handedness | null>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result === "LEFT" || request.result === "RIGHT" ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error("Could not read handedness"));
  });
  database.close();
  return handedness;
}

/** Practice milliseconds per practice day ("YYYY-MM-DD", rolling over at 4 am). */
export async function savePracticeTime(totals: DailyTotals): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(SETTINGS, "readwrite");
  transaction.objectStore(SETTINGS).put(totals, PRACTICE_TIME_KEY);
  await waitForTransaction(transaction);
  database.close();
}

export async function getPracticeTime(): Promise<DailyTotals | null> {
  const database = await openDatabase();
  const request = database.transaction(SETTINGS, "readonly").objectStore(SETTINGS).get(PRACTICE_TIME_KEY);
  const totals = await new Promise<DailyTotals | null>((resolve, reject) => {
    request.onsuccess = () => {
      const value: unknown = request.result;
      if (!value || typeof value !== "object") { resolve(null); return; }
      // Keep only well-formed entries.
      resolve(Object.fromEntries(Object.entries(value).filter(([key, ms]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && typeof ms === "number" && Number.isFinite(ms) && ms >= 0)));
    };
    request.onerror = () => reject(request.error ?? new Error("Could not read practice time"));
  });
  database.close();
  return totals;
}

async function putSetting(key: string, value: unknown): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(SETTINGS, "readwrite");
  transaction.objectStore(SETTINGS).put(value, key);
  await waitForTransaction(transaction);
  database.close();
}

async function getSetting(key: string): Promise<unknown> {
  const database = await openDatabase();
  const request = database.transaction(SETTINGS, "readonly").objectStore(SETTINGS).get(key);
  const value = await new Promise<unknown>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Could not read ${key}`));
  });
  database.close();
  return value;
}

const DAILY_TICKS_KEY = "daily-queue-ticks";
const DAILY_QUEUE_KEY = "daily-queue-state";

/** The standing per-mode ticks for the Today queue. */
export async function saveDailyTicks(ticks: readonly ExerciseType[]): Promise<void> {
  await putSetting(DAILY_TICKS_KEY, [...ticks]);
}

/** Null when never set (the app then uses the defaults). */
export async function getDailyTicks(): Promise<ExerciseType[] | null> {
  const value = await getSetting(DAILY_TICKS_KEY);
  return Array.isArray(value) ? normalizeTicks(value.filter((item): item is string => typeof item === "string")) : null;
}

export async function saveDailyQueue(state: DailyQueueState): Promise<void> {
  await putSetting(DAILY_QUEUE_KEY, state);
}

export async function getDailyQueue(): Promise<DailyQueueState | null> {
  return parseQueueState(await getSetting(DAILY_QUEUE_KEY));
}

/* ---------- Daily flow (drills, then a timed stretch of Copy) ---------- */

const COPY_TIME_KEY = "copy-time-by-day";
const COPY_BUDGET_KEY = "copy-budget-minutes";
const DAY_MARKS_KEY = "daily-flow-marks";

/** Active Copy milliseconds per practice day, kept like practice-time-by-day. */
export async function saveCopyTime(totals: DailyTotals): Promise<void> {
  await putSetting(COPY_TIME_KEY, totals);
}

export async function getCopyTime(): Promise<DailyTotals | null> {
  const value = await getSetting(COPY_TIME_KEY);
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).filter(([key, ms]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && typeof ms === "number" && Number.isFinite(ms) && ms >= 0));
}

const MEMORY_TIME_KEY = "memory-time-by-day";

/** Active Memory milliseconds per practice day (0.19.0+), kept like Copy time. */
export async function saveMemoryTime(totals: DailyTotals): Promise<void> {
  await putSetting(MEMORY_TIME_KEY, totals);
}

export async function getMemoryTime(): Promise<DailyTotals | null> {
  return dailyTotalsFrom(await getSetting(MEMORY_TIME_KEY));
}

function dailyTotalsFrom(value: unknown): DailyTotals | null {
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).filter(([key, ms]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && typeof ms === "number" && Number.isFinite(ms) && ms >= 0));
}

/** Copy time per day in minutes; 0 is Off. */
export async function saveCopyBudget(minutes: number): Promise<void> {
  await putSetting(COPY_BUDGET_KEY, minutes);
}

export async function getCopyBudget(): Promise<number | null> {
  return parseCopyBudget(await getSetting(COPY_BUDGET_KEY));
}

export async function saveDayMarks(marks: DayMarks): Promise<void> {
  await putSetting(DAY_MARKS_KEY, marks);
}

export async function getDayMarks(): Promise<DayMarks | null> {
  return parseMarks(await getSetting(DAY_MARKS_KEY));
}

/** Practice days (4 am day keys) whose daily flow was finished, for the seven-dot row on the Done card. */
const FINISHED_DAYS_KEY = "finished-days";

export async function saveFinishedDays(days: readonly string[]): Promise<void> {
  await putSetting(FINISHED_DAYS_KEY, [...days]);
}

export async function getFinishedDays(): Promise<string[]> {
  return parseFinishedDays(await getSetting(FINISHED_DAYS_KEY));
}

/** When practice data was last exported (epoch ms), for the backup reminder on the Done card. */
const LAST_EXPORT_KEY = "last-export";

export async function saveLastExport(epochMs: number): Promise<void> {
  await putSetting(LAST_EXPORT_KEY, epochMs);
}

export async function getLastExport(): Promise<number | null> {
  return parseLastExport(await getSetting(LAST_EXPORT_KEY));
}

/** How much trimming has removed so far: trials trimmed and Pencil samples removed. */
const PRUNED_KEY = "retention-pruned";

export interface PrunedTotals {
  trials: number;
  samples: number;
  strokesDeleted: number;
}

export async function savePrunedTotals(totals: PrunedTotals): Promise<void> {
  await putSetting(PRUNED_KEY, totals);
}

export async function getPrunedTotals(): Promise<PrunedTotals> {
  const value = await getSetting(PRUNED_KEY) as Partial<PrunedTotals> | undefined;
  const count = (item: unknown) => (typeof item === "number" && Number.isFinite(item) && item >= 0 ? item : 0);
  return { trials: count(value?.trials), samples: count(value?.samples), strokesDeleted: count(value?.strokesDeleted) };
}
