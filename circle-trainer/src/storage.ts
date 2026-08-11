import type { PhysicalCalibration, RawStroke } from "./core/types";

const DB_NAME = "circle-trainer";
const DB_VERSION = 1;
const STROKES = "strokes";
const SETTINGS = "settings";
const CALIBRATION_KEY = "physical-calibration";

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
