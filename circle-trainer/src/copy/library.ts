/**
 * Copy-mode library: books (PDFs and images) stored as Blobs in their own
 * IndexedDB database, separate from the practice database so its schema and
 * data are never touched.
 */

const DB_NAME = "circle-trainer-library";
const DB_VERSION = 1;
const BOOKS = "books";
const COPY = "copy";

export type BookKind = "pdf" | "image";

export interface BookMeta {
  id: string;
  name: string;
  kind: BookKind;
  size: number;
  addedAt: number;
  lastOpenedAt: number;
  pageCount: number | null;
  lastView: unknown;
}

export interface BookRecord extends BookMeta {
  file: Blob;
}

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BOOKS)) database.createObjectStore(BOOKS, { keyPath: "id" });
      if (!database.objectStoreNames.contains(COPY)) database.createObjectStore(COPY);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the library"));
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Library transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Library transaction was cancelled"));
  });
}

function result<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error("Library read failed"));
  });
}

/** Not crypto.randomUUID: that needs a secure context, and the dev server over Wi-Fi is plain http. */
export function newBookId(now = Date.now(), random = Math.random): string {
  return `book-${now.toString(36)}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0")}`;
}

export function bookKindOf(file: { name: string; type: string }): BookKind | null {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.type.startsWith("image/")) return "image";
  return null;
}

export async function addBook(file: File, kind: BookKind, now = Date.now()): Promise<BookRecord> {
  const record: BookRecord = {
    id: newBookId(now),
    name: file.name.replace(/\.[^.]+$/, ""),
    kind,
    size: file.size,
    addedAt: now,
    lastOpenedAt: now,
    pageCount: kind === "image" ? 1 : null,
    lastView: null,
    file,
  };
  const database = await openLibrary();
  try {
    const transaction = database.transaction(BOOKS, "readwrite");
    transaction.objectStore(BOOKS).put(record);
    await done(transaction);
  } finally {
    database.close();
  }
  return record;
}

export async function getBook(id: string): Promise<BookRecord | undefined> {
  const database = await openLibrary();
  try {
    return await result<BookRecord | undefined>(database.transaction(BOOKS, "readonly").objectStore(BOOKS).get(id));
  } finally {
    database.close();
  }
}

/** Metadata only; the Blobs are dropped so listing does not hold file handles. */
export async function listBooks(): Promise<BookMeta[]> {
  const database = await openLibrary();
  try {
    const records = await result<BookRecord[]>(database.transaction(BOOKS, "readonly").objectStore(BOOKS).getAll());
    return records
      .map(({ file: _file, ...meta }) => meta)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } finally {
    database.close();
  }
}

export async function updateBook(id: string, changes: Partial<Omit<BookMeta, "id">>): Promise<void> {
  const database = await openLibrary();
  try {
    const transaction = database.transaction(BOOKS, "readwrite");
    const store = transaction.objectStore(BOOKS);
    const record = await result<BookRecord | undefined>(store.get(id));
    if (record) store.put({ ...record, ...changes });
    await done(transaction);
  } finally {
    database.close();
  }
}

export async function removeBook(id: string): Promise<void> {
  const database = await openLibrary();
  try {
    const transaction = database.transaction(BOOKS, "readwrite");
    transaction.objectStore(BOOKS).delete(id);
    await done(transaction);
  } finally {
    database.close();
  }
}

const CURRENT_COPY_KEY = "current";

/** The single autosaved copy in progress (see copySession.ts). Replaced when a new copy starts. */
export async function saveCurrentCopy(session: unknown): Promise<void> {
  const database = await openLibrary();
  try {
    const transaction = database.transaction(COPY, "readwrite");
    transaction.objectStore(COPY).put(session, CURRENT_COPY_KEY);
    await done(transaction);
  } finally {
    database.close();
  }
}

export async function loadCurrentCopy(): Promise<unknown> {
  const database = await openLibrary();
  try {
    return await result<unknown>(database.transaction(COPY, "readonly").objectStore(COPY).get(CURRENT_COPY_KEY));
  } finally {
    database.close();
  }
}
