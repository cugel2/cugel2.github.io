/**
 * Everything is kept on the iPad in IndexedDB ("nicolaides"):
 *   kv      progress, settings, the Muybridge deck, each day's poses ("poses:<day>")
 *   sheets  every drawing, by id, indexed by day
 * Frame images are cached separately with the Cache API (frames.ts).
 */
import type { Sheet } from "./sheet";

const DB_NAME = "nicolaides";
const DB_VERSION = 1;
const KV = "kv";
const SHEETS = "sheets";

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(SHEETS)) db.createObjectStore(SHEETS, { keyPath: "id" }).createIndex("day", "day");
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); opening = null; };
      resolve(request.result);
    };
    request.onerror = () => { opening = null; reject(request.error); };
  });
  return opening;
}

function run<T>(store: string, mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = body(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export function getValue<T>(key: string): Promise<T | undefined> {
  return run<T | undefined>(KV, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
}

export function setValue(key: string, value: unknown): Promise<void> {
  return run(KV, "readwrite", (s) => s.put(value, key)).then(() => undefined);
}

export function putSheet(sheet: Sheet): Promise<void> {
  return run(SHEETS, "readwrite", (s) => s.put(sheet)).then(() => undefined);
}

export function getSheet(id: string): Promise<Sheet | undefined> {
  return run<Sheet | undefined>(SHEETS, "readonly", (s) => s.get(id) as IDBRequest<Sheet | undefined>);
}

export function deleteSheet(id: string): Promise<void> {
  return run(SHEETS, "readwrite", (s) => s.delete(id)).then(() => undefined);
}

export function allSheets(): Promise<Sheet[]> {
  return run<Sheet[]>(SHEETS, "readonly", (s) => s.getAll() as IDBRequest<Sheet[]>);
}

export function allValues(): Promise<Record<string, unknown>> {
  return open().then((db) => new Promise((resolve, reject) => {
    const out: Record<string, unknown> = {};
    const tx = db.transaction(KV, "readonly");
    const request = tx.objectStore(KV).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      out[String(cursor.key)] = cursor.value;
      cursor.continue();
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  }));
}

/** Asks Safari to keep this site's storage; adding the app to the Home Screen helps too. */
export async function askToPersist(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
