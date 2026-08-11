import type { LegacyLineTrialRecord, PhysicalCalibration, PracticeMode, RawStroke, TrialRecord } from "./core/types";

const DB_NAME = "circle-trainer";
const DB_VERSION = 2;
const STROKES = "strokes";
const TRIALS = "trials";
const SETTINGS = "settings";
const CALIBRATION_KEY = "physical-calibration";
const PRACTICE_MODE_KEY = "practice-mode";

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

export function normalizeStoredTrial(trial: TrialRecord | LegacyLineTrialRecord, index: number): TrialRecord {
  if ("exerciseType" in trial) return trial;
  return {
    ...trial,
    exerciseType: "LINE",
    practiceMode: "LINE",
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
