/**
 * Copy-mode library: books (PDFs and images) in their own IndexedDB
 * database, separate from the practice database so its schema and data are
 * never touched.
 *
 * Each book's file lives in its own store (`files`), apart from its details
 * (`books`). Saving details (where you were, page sizes) must never rewrite
 * the file: Safari stores a rewritten Blob as a new file and deletes the old
 * one, and a Blob being read lazily (a PDF) then fails with NotFoundError.
 * Version 1 kept the file inside the book record; opening the database moves
 * it out.
 */

const DB_NAME = "circle-trainer-library";
const DB_VERSION = 2;
const BOOKS = "books";
const FILES = "files";
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
  /** Each page's size, measured on first open so later opens skip it. */
  pageSizes?: Array<{ width: number; height: number }>;
  lastView: unknown;
}

export interface BookRecord extends BookMeta {
  file: Blob;
}

/**
 * One connection, kept open: Safari ties Blobs read from IndexedDB to the
 * database, so closing it after every call is asking for trouble.
 */
let connection: Promise<IDBDatabase> | null = null;

function openLibrary(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const transaction = request.transaction!;
      if (!database.objectStoreNames.contains(BOOKS)) database.createObjectStore(BOOKS, { keyPath: "id" });
      if (!database.objectStoreNames.contains(COPY)) database.createObjectStore(COPY);
      if (!database.objectStoreNames.contains(FILES)) database.createObjectStore(FILES);
      if (event.oldVersion >= 1 && event.oldVersion < 2) moveFilesOut(transaction);
    };
    request.onsuccess = () => {
      const database = request.result;
      // Another tab upgrading the database: step aside so it can.
      database.onversionchange = () => { database.close(); connection = null; };
      database.onclose = () => { connection = null; };
      resolve(database);
    };
    request.onerror = () => { connection = null; reject(request.error ?? new Error("Could not open the library")); };
    request.onblocked = () => { connection = null; reject(new Error("The library is open in another tab")); };
  });
  return connection;
}

/** Version 1 → 2: each book's file moves from its record into the files store. */
function moveFilesOut(transaction: IDBTransaction): void {
  const books = transaction.objectStore(BOOKS);
  const files = transaction.objectStore(FILES);
  const cursorRequest = books.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    const { file, ...meta } = cursor.value as BookRecord;
    if (file) {
      files.put(file, meta.id);
      cursor.update(meta);
    }
    cursor.continue();
  };
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

/** Details only, as stored in the books store. */
function metaOf(value: BookMeta & { file?: Blob }): BookMeta {
  const { file: _file, ...meta } = value;
  return meta;
}

export async function addBook(file: File, kind: BookKind, now = Date.now()): Promise<BookMeta> {
  const meta: BookMeta = {
    id: newBookId(now),
    name: file.name.replace(/\.[^.]+$/, ""),
    kind,
    size: file.size,
    addedAt: now,
    lastOpenedAt: now,
    pageCount: kind === "image" ? 1 : null,
    lastView: null,
  };
  const database = await openLibrary();
  const transaction = database.transaction([BOOKS, FILES], "readwrite");
  transaction.objectStore(FILES).put(file, meta.id);
  transaction.objectStore(BOOKS).put(meta);
  await done(transaction);
  return meta;
}

export async function getBook(id: string): Promise<BookRecord | undefined> {
  const database = await openLibrary();
  const transaction = database.transaction([BOOKS, FILES], "readonly");
  const [meta, file] = await Promise.all([
    result<BookMeta | undefined>(transaction.objectStore(BOOKS).get(id)),
    result<Blob | undefined>(transaction.objectStore(FILES).get(id)),
  ]);
  if (!meta || !file) return undefined;
  return { ...metaOf(meta), file };
}

export async function listBooks(): Promise<BookMeta[]> {
  const database = await openLibrary();
  const records = await result<BookMeta[]>(database.transaction(BOOKS, "readonly").objectStore(BOOKS).getAll());
  return records.map(metaOf).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

/** Changes a book's details. Never touches its file. */
export async function updateBook(id: string, changes: Partial<Omit<BookMeta, "id">>): Promise<void> {
  const database = await openLibrary();
  const transaction = database.transaction(BOOKS, "readwrite");
  const store = transaction.objectStore(BOOKS);
  const meta = await result<BookMeta | undefined>(store.get(id));
  if (meta) store.put({ ...metaOf(meta), ...changes, id });
  await done(transaction);
}

export async function removeBook(id: string): Promise<void> {
  const database = await openLibrary();
  const transaction = database.transaction([BOOKS, FILES], "readwrite");
  transaction.objectStore(BOOKS).delete(id);
  transaction.objectStore(FILES).delete(id);
  await done(transaction);
}

const CURRENT_COPY_KEY = "current";

/** The single autosaved copy in progress (see copySession.ts). Replaced when a new copy starts. */
export async function saveCurrentCopy(session: unknown): Promise<void> {
  const database = await openLibrary();
  const transaction = database.transaction(COPY, "readwrite");
  transaction.objectStore(COPY).put(session, CURRENT_COPY_KEY);
  await done(transaction);
}

export async function loadCurrentCopy(): Promise<unknown> {
  const database = await openLibrary();
  return result<unknown>(database.transaction(COPY, "readonly").objectStore(COPY).get(CURRENT_COPY_KEY));
}
