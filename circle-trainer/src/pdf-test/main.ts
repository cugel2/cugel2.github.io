/**
 * Copy mode, stage 0: feasibility check for large PDFs in iPad Safari.
 * A bare page, not the finished UI. See COPY-MODE-PLAN.md.
 */
import type { PDFPageProxy, RenderTask } from "pdfjs-dist";
import { addBook, bookKindOf, getBook, listBooks, removeBook, updateBook, type BookMeta } from "../copy/library";
import { loadPdfJs, openPdfBlob, type OpenedPdf } from "../copy/pdfSource";

const BUSY_KEY = "pdf-test-busy";
const DETAIL_ZOOM = 3;
/** A page still drawing after this long is reported, with what it is waiting on. */
const SLOW_DRAW_MS = 8000;
const RUN_LENGTH = 10;

function $<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

const fileInput = $<HTMLInputElement>("fileInput");
const bookList = $<HTMLUListElement>("bookList");
const results = $<HTMLTableSectionElement>("results");
const pageTimes = $<HTMLTableSectionElement>("pageTimes");
const logView = $<HTMLPreElement>("log");
const deviceTable = $<HTMLTableSectionElement>("device");
const notices = $<HTMLDivElement>("notices");
const prevButton = $<HTMLButtonElement>("prevButton");
const nextButton = $<HTMLButtonElement>("nextButton");
const goButton = $<HTMLButtonElement>("goButton");
const pageInput = $<HTMLInputElement>("pageInput");
const detailButton = $<HTMLButtonElement>("detailButton");
const runButton = $<HTMLButtonElement>("runButton");
const closeButton = $<HTMLButtonElement>("closeButton");
const pageCaption = $<HTMLParagraphElement>("pageCaption");
const canvas = $<HTMLCanvasElement>("pageCanvas");

const runtimeBase = new URL("../pdfjs/", document.baseURI);
const pageStartedAt = performance.now();

let opened: (OpenedPdf & { book: BookMeta }) | null = null;
let currentPage = 1;
let renderTask: RenderTask | null = null;
/**
 * The page last drawn stays loaded, so drawing it again (e.g. Zoom 3×) reuses
 * its decoded images, as Copy mode will while you copy from one page.
 */
let heldPage: PDFPageProxy | null = null;

function releaseHeldPage(): void {
  heldPage?.cleanup();
  heldPage = null;
}
let busy = false;
const resultRows = new Map<string, HTMLTableCellElement>();

// ----- output helpers -----

function ms(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

function megabytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function log(message: string, isError = false): void {
  const seconds = ((performance.now() - pageStartedAt) / 1000).toFixed(1).padStart(6);
  const line = document.createElement("span");
  line.textContent = `${seconds}s  ${message}\n`;
  if (isError) line.className = "error";
  logView.append(line);
  logView.scrollTop = logView.scrollHeight;
}

function setResult(label: string, value: string, isError = false): void {
  let cell = resultRows.get(label);
  if (!cell) {
    const row = results.insertRow();
    const header = document.createElement("th");
    header.textContent = label;
    row.append(header);
    cell = row.insertCell();
    resultRows.set(label, cell);
  }
  cell.textContent = value;
  cell.className = isError ? "error" : "";
}

function addTableRow(table: HTMLTableSectionElement, label: string, value: string): void {
  const row = table.insertRow();
  const header = document.createElement("th");
  header.textContent = label;
  row.append(header);
  row.insertCell().textContent = value;
}

function notice(text: string, bad = false): void {
  const box = document.createElement("p");
  box.className = bad ? "notice bad" : "notice";
  box.textContent = text;
  notices.append(box);
}

function showReadStats(): void {
  if (!opened) return;
  const { stats, book } = opened;
  const share = book.size > 0 ? (100 * stats.bytesRead) / book.size : 0;
  setResult("File read so far (kept in memory)", `${megabytes(stats.bytesRead)} of ${megabytes(book.size)} (${share.toFixed(1)}%) in ${stats.requests} reads, ${ms(stats.readMs)} waiting`);
}

/** PDF.js reports problems (e.g. an image it could not decode) as console warnings on the main thread. */
function captureConsole(): void {
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      log(`console.${level}: ${args.map((arg) => (arg instanceof Error ? errorText(arg) : String(arg))).join(" ")}`, level === "error");
    };
  }
  const originalLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    originalLog(...args);
    const text = args.map(String).join(" ");
    if (/warning|error/i.test(text)) log(`console.log: ${text}`);
  };
  window.addEventListener("error", (event) => log(`Uncaught: ${event.message}`, true));
  window.addEventListener("unhandledrejection", (event) => log(`Unhandled: ${errorText(event.reason)}`, true));
}

// ----- previous run, device -----

function checkPreviousRun(): void {
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  let interrupted: string | null = null;
  try { interrupted = sessionStorage.getItem(BUSY_KEY); sessionStorage.removeItem(BUSY_KEY); } catch { /* storage blocked */ }
  if (interrupted) {
    notice(`The last visit to this page ended while it was busy (${interrupted}). If you did not reload it yourself, Safari reloaded the tab, probably for lack of memory.`, true);
  }
  setResult("This page load", navigation?.type === "reload" ? "reload" : navigation?.type ?? "unknown");
}

function markBusy(what: string | null): void {
  try {
    if (what) sessionStorage.setItem(BUSY_KEY, what);
    else sessionStorage.removeItem(BUSY_KEY);
  } catch { /* storage blocked */ }
}

async function describeDevice(): Promise<void> {
  addTableRow(deviceTable, "Browser", navigator.userAgent);
  addTableRow(deviceTable, "Screen", `${screen.width} × ${screen.height} pt, ${devicePixelRatio}× pixels`);
  addTableRow(deviceTable, "Secure context", window.isSecureContext ? "yes" : "no (plain http: storage estimate and persistence unavailable)");
  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      addTableRow(deviceTable, "Storage used", `${megabytes(estimate.usage ?? 0)} of ${megabytes(estimate.quota ?? 0)} allowed`);
    } catch (error) { addTableRow(deviceTable, "Storage used", errorText(error)); }
  }
  if (navigator.storage?.persisted) {
    try { addTableRow(deviceTable, "Storage kept by Safari", (await navigator.storage.persisted()) ? "yes" : "no (may be cleared after disuse)"); } catch { /* ignore */ }
  }
  try {
    const started = performance.now();
    const pdfjs = await loadPdfJs();
    addTableRow(deviceTable, "PDF.js", `${pdfjs.version} (legacy build), loaded in ${ms(performance.now() - started)}`);
    setResult("PDF.js", `loaded, ${pdfjs.version}`);
  } catch (error) {
    setResult("PDF.js", `failed to load: ${errorText(error)}`, true);
    log(`PDF.js failed to load: ${errorText(error)}`, true);
  }
  addTableRow(deviceTable, "Decoder files from", runtimeBase.href);
  await checkDecoders();
}

/**
 * PDF.js starts its JPEG 2000 and JBIG2 decoders as WebAssembly inside its
 * worker and silently falls back to much slower JavaScript if that fails.
 * Try the same thing here, in a worker, and show the error if there is one.
 */
const DECODER_CHECK_WORKER = `
self.onmessage = async (event) => {
  const results = [];
  for (const url of event.data) {
    const name = url.split("/").slice(-2).join("/");
    try {
      const bytes = await (await fetch(url, { cache: "no-store" })).arrayBuffer();
      const module = await WebAssembly.compile(bytes);
      const imports = {};
      for (const entry of WebAssembly.Module.imports(module)) {
        imports[entry.module] ??= {};
        imports[entry.module][entry.name] = () => 0;
      }
      await WebAssembly.instantiate(module, imports);
      results.push(name + ": works");
    } catch (error) {
      results.push(name + ": FAILED: " + (error && error.name ? error.name + ": " + error.message : String(error)));
    }
  }
  self.postMessage(results);
};`;

async function checkDecoders(): Promise<void> {
  const urls = ["openjpeg.wasm", "jbig2.wasm"].map((name) => new URL(`wasm/${name}`, runtimeBase).href);
  try {
    const worker = new Worker(URL.createObjectURL(new Blob([DECODER_CHECK_WORKER], { type: "text/javascript" })));
    const results = await new Promise<string[]>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("no answer after 10 s")), 10_000);
      worker.onmessage = (event) => { window.clearTimeout(timer); resolve(event.data as string[]); };
      worker.onerror = (event) => { window.clearTimeout(timer); reject(new Error(event.message || "worker error")); };
      worker.postMessage(urls);
    });
    worker.terminate();
    const failed = results.some((line) => line.includes("FAILED"));
    setResult("Fast image decoders", results.join("; "), failed);
    for (const line of results) log(`Decoder check: ${line}`, line.includes("FAILED"));
  } catch (error) {
    setResult("Fast image decoders", `check failed: ${errorText(error)}`, true);
    log(`Decoder check failed: ${errorText(error)}`, true);
  }
}

// ----- library -----

async function refreshBooks(): Promise<void> {
  let books: BookMeta[];
  try {
    books = await listBooks();
  } catch (error) {
    bookList.innerHTML = "";
    const item = document.createElement("li");
    item.className = "error";
    item.textContent = `Could not read stored books: ${errorText(error)}`;
    bookList.append(item);
    return;
  }
  bookList.innerHTML = "";
  if (books.length === 0) {
    const item = document.createElement("li");
    item.className = "muted";
    item.textContent = "None stored yet.";
    bookList.append(item);
  }
  for (const book of books) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    const pages = book.pageCount ? `, ${book.pageCount} pages` : "";
    name.textContent = `${book.name} — ${megabytes(book.size)}${pages}`;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "primary";
    open.textContent = opened?.book.id === book.id ? "Reopen" : "Open";
    open.addEventListener("click", () => void openBook(book.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => void removeStoredBook(book));
    item.append(name, open, remove);
    bookList.append(item);
  }
}

async function importFile(file: File): Promise<void> {
  const kind = bookKindOf(file);
  if (kind !== "pdf") {
    log(`${file.name} is not a PDF`, true);
    return;
  }
  setResult("File", `${file.name}, ${megabytes(file.size)}`);
  log(`Storing ${file.name} (${megabytes(file.size)})…`);
  setBusy(true, "storing a PDF");
  const started = performance.now();
  try {
    const book = await addBook(file, "pdf");
    const elapsed = performance.now() - started;
    setResult("Import (store on device)", ms(elapsed));
    log(`Stored in ${ms(elapsed)}`);
    await refreshBooks();
    setBusy(false);
    await openBook(book.id);
  } catch (error) {
    setResult("Import (store on device)", `failed: ${errorText(error)}`, true);
    log(`Storing failed: ${errorText(error)}`, true);
  } finally {
    setBusy(false);
  }
}

async function removeStoredBook(book: BookMeta): Promise<void> {
  if (!window.confirm(`Remove “${book.name}” from this device?`)) return;
  if (opened?.book.id === book.id) await closeBook();
  try {
    await removeBook(book.id);
    log(`Removed ${book.name}`);
  } catch (error) {
    log(`Remove failed: ${errorText(error)}`, true);
  }
  await refreshBooks();
}

async function openBook(id: string): Promise<void> {
  if (busy) return;
  await closeBook();
  setBusy(true, "opening a PDF");
  try {
    const readStarted = performance.now();
    const record = await getBook(id);
    if (!record) throw new Error("That book is no longer stored");
    const readMs = performance.now() - readStarted;
    const { file, ...book } = record;
    setResult("File", `${book.name}, ${megabytes(book.size)}`);
    log(`Fetched ${book.name} from storage in ${ms(readMs)} (a Blob of ${megabytes(file.size)})`);

    const openStarted = performance.now();
    const pdf = await openPdfBlob(file, runtimeBase, {
      reacquire: async () => {
        const again = await getBook(id);
        if (!again) throw new Error("book gone");
        log("Fetched the file again from storage to retry");
        return again.file;
      },
      onReadError: (message) => log(message, true),
    });
    const openMs = performance.now() - openStarted;
    opened = { ...pdf, book };
    setResult("Open", `${ms(readMs + openMs)} (storage ${ms(readMs)}, PDF.js ${ms(openMs)})`);
    setResult("Pages", String(pdf.document.numPages));
    log(`Opened: ${pdf.document.numPages} pages in ${ms(openMs)}`);
    showReadStats();
    void updateBook(id, { lastOpenedAt: Date.now(), pageCount: pdf.document.numPages }).then(refreshBooks, () => undefined);

    pageInput.max = String(pdf.document.numPages);
    currentPage = 1;
    setBusy(false);
    await drawPage(1);
  } catch (error) {
    setResult("Open", `failed: ${errorText(error)}`, true);
    log(`Open failed: ${errorText(error)}`, true);
    opened = null;
  } finally {
    setBusy(false);
  }
}

async function closeBook(): Promise<void> {
  renderTask?.cancel();
  renderTask = null;
  releaseHeldPage();
  if (!opened) return;
  const closing = opened;
  opened = null;
  canvas.width = 0;
  canvas.height = 0;
  pageCaption.textContent = "Open a book to draw its pages.";
  updateControls();
  try { await closing.close(); } catch { /* already gone */ }
  log(`Closed ${closing.book.name}`);
  await refreshBooks();
}

// ----- rendering -----

interface DrawResult { loadMs: number; drawMs: number; width: number; height: number }

async function renderInto(page: PDFPageProxy, zoom: number): Promise<DrawResult> {
  const cssWidth = Math.max(200, canvas.parentElement!.clientWidth - 16);
  const base = page.getViewport({ scale: 1 });
  const fitScale = cssWidth / base.width;
  const pixelRatio = window.devicePixelRatio || 1;
  // The canvas is always frame-sized; zooming renders a smaller region of the
  // page at a higher scale, as Copy mode will.
  const viewport = page.getViewport({ scale: fitScale * zoom * pixelRatio });
  const width = Math.floor(cssWidth * pixelRatio);
  const height = Math.floor(base.height * fitScale * pixelRatio);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D unavailable");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  const offsetX = (viewport.width - width) / 2;
  const offsetY = (viewport.height - height) / 2;

  const started = performance.now();
  renderTask = page.render({
    canvas,
    viewport,
    transform: zoom === 1 ? undefined : [1, 0, 0, 1, -offsetX, -offsetY],
  });
  try {
    await renderTask.promise;
  } finally {
    renderTask = null;
  }
  return { loadMs: 0, drawMs: performance.now() - started, width, height };
}

function recordPageTime(label: string, result: DrawResult): void {
  if (pageTimes.querySelector(".muted")) pageTimes.innerHTML = "";
  const row = pageTimes.insertRow(0);
  row.insertCell().textContent = label;
  row.insertCell().textContent = ms(result.loadMs);
  row.insertCell().textContent = ms(result.drawMs);
  row.insertCell().textContent = `${result.width} × ${result.height}`;
}

async function drawPage(pageNumber: number, zoom = 1): Promise<boolean> {
  if (!opened) return false;
  const pdf = opened;
  let label = zoom === 1 ? String(pageNumber) : `${pageNumber} at ${zoom}×`;
  renderTask?.cancel();
  setBusy(true, `drawing page ${label}`);
  pageCaption.textContent = `Drawing page ${label}…`;
  const drawStarted = performance.now();
  let stage = "loading the page";
  const watchdog = window.setInterval(() => {
    void framesRunning().then((frames) => {
      const { stats } = pdf;
      const seconds = Math.round((performance.now() - drawStarted) / 1000);
      log(`Page ${label} still ${stage} after ${seconds} s: ${stats.pending} file reads waiting, ${stats.failures} failed, ${stats.requests} done; animation frames ${frames ? "running" : "NOT running"}; page ${document.visibilityState}`, true);
    });
  }, SLOW_DRAW_MS);
  try {
    const loadStarted = performance.now();
    const page = await pdf.document.getPage(pageNumber);
    if (heldPage && heldPage !== page) releaseHeldPage();
    const again = heldPage === page;
    heldPage = page;
    const loadMs = performance.now() - loadStarted;
    stage = "drawing";
    const result = { ...(await renderInto(page, zoom)), loadMs };
    if (opened !== pdf) return false;
    if (again) label += " again";
    currentPage = pageNumber;
    pageInput.value = String(pageNumber);
    recordPageTime(label, result);
    setResult("Last page", `${label}: load ${ms(loadMs)}, draw ${ms(result.drawMs)}`);
    pageCaption.textContent = `Page ${pageNumber} of ${pdf.document.numPages}${zoom === 1 ? "" : `, middle at ${zoom}× zoom`}`;
    log(`Page ${label}: load ${ms(loadMs)}, draw ${ms(result.drawMs)}, canvas ${result.width}×${result.height}`);
    showReadStats();
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "RenderingCancelledException") {
      log(`Page ${label}: cancelled`);
      return false;
    }
    setResult("Last page", `${label}: failed: ${errorText(error)}`, true);
    log(`Page ${label} failed: ${errorText(error)}`, true);
    pageCaption.textContent = `Page ${pageNumber} could not be drawn.`;
    return false;
  } finally {
    window.clearInterval(watchdog);
    setBusy(false);
  }
}

/** PDF.js paces drawing with requestAnimationFrame; if frames stop, drawing stops. */
function framesRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(false), 1000);
    requestAnimationFrame(() => { window.clearTimeout(timer); resolve(true); });
  });
}

async function drawRun(): Promise<void> {
  if (!opened) return;
  const pdf = opened;
  const first = currentPage + 1;
  const last = Math.min(pdf.document.numPages, currentPage + RUN_LENGTH);
  if (first > last) { log("Already at the last page"); return; }
  const times: number[] = [];
  runButton.textContent = "Drawing…";
  for (let page = first; page <= last && opened === pdf; page += 1) {
    const started = performance.now();
    if (!(await drawPage(page))) break;
    times.push(performance.now() - started);
  }
  runButton.textContent = `Draw next ${RUN_LENGTH}`;
  if (times.length) {
    const average = times.reduce((sum, value) => sum + value, 0) / times.length;
    setResult(`Pages ${first}–${first + times.length - 1}`, `average ${ms(average)}, slowest ${ms(Math.max(...times))}`);
  }
}

// ----- controls -----

function setBusy(value: boolean, what?: string): void {
  busy = value;
  markBusy(value ? what ?? "busy" : null);
  updateControls();
}

function updateControls(): void {
  const pages = opened?.document.numPages ?? 0;
  const ready = Boolean(opened) && !busy;
  prevButton.disabled = !ready || currentPage <= 1;
  nextButton.disabled = !ready || currentPage >= pages;
  goButton.disabled = !ready;
  pageInput.disabled = !opened;
  detailButton.disabled = !ready;
  runButton.disabled = !ready || currentPage >= pages;
  closeButton.disabled = !opened;
  fileInput.disabled = busy;
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) void importFile(file);
});
prevButton.addEventListener("click", () => void drawPage(currentPage - 1));
nextButton.addEventListener("click", () => void drawPage(currentPage + 1));
goButton.addEventListener("click", () => {
  const pages = opened?.document.numPages ?? 1;
  const target = Math.min(pages, Math.max(1, Math.round(Number(pageInput.value) || 1)));
  void drawPage(target);
});
pageInput.addEventListener("keydown", (event) => { if (event.key === "Enter") goButton.click(); });
detailButton.addEventListener("click", () => void drawPage(currentPage, DETAIL_ZOOM));
runButton.addEventListener("click", () => void drawRun());
closeButton.addEventListener("click", () => void closeBook());

captureConsole();
checkPreviousRun();
updateControls();
void refreshBooks();
void describeDevice();
