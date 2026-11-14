/**
 * PDF.js loading for Copy mode. PDF.js is imported only when a PDF is opened,
 * and the file is read lazily: PDF.js asks for byte ranges and we answer each
 * with `blob.slice(begin, end).arrayBuffer()`, so a large book is never held
 * in memory as one buffer.
 *
 * Uses the legacy build: PDF.js lists Safari only under its legacy build.
 */
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import type { PageSize } from "./docSpace";
import type { PageRegion, PageSource } from "./pageSource";

export interface RangeReadStats {
  requests: number;
  bytesRead: number;
  /** Largest single range served, in bytes. */
  largestRead: number;
  /** Total time spent waiting on blob.slice().arrayBuffer(), in ms. */
  readMs: number;
  /** Reads asked for by PDF.js and not yet answered. */
  pending: number;
  /** Reads that failed at least once (each is retried). */
  failures: number;
  lastError: string | null;
}

export interface OpenPdfOptions {
  /**
   * Fetches the file again, e.g. from IndexedDB, when reading the current Blob
   * fails. Safari can make a stored Blob unreadable; a fresh one may work.
   */
  reacquire?: () => Promise<Blob>;
  onReadError?: (message: string) => void;
  /** Reading failed for good: PDF.js has stopped, and the book must be reopened. */
  onFatal?: (message: string) => void;
}

const READ_ATTEMPTS = 3;

export interface OpenedPdf {
  document: PDFDocumentProxy;
  stats: RangeReadStats;
  close(): Promise<void>;
}

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((module) => {
    module.GlobalWorkerOptions.workerSrc = workerUrl;
    return module as unknown as PdfJs;
  });
  return pdfjsPromise;
}

/**
 * Bytes PDF.js asks for per range request (its default). On open PDF.js visits
 * every page object to check the page tree, one chunk each when pages are
 * spread through the file, so a larger chunk makes opening a long book read
 * far more of it. Note: PDF.js's worker reserves a buffer the size of the file
 * and keeps each chunk it has read, so memory grows as pages are visited.
 */
const RANGE_CHUNK_BYTES = 64 * 1024;

/**
 * @param runtimeBase URL of the folder holding `wasm/`, `iccs/` and
 *   `standard_fonts/` (the build copies them to `pdfjs/`).
 */
export async function openPdfBlob(initialBlob: Blob, runtimeBase: URL, options: OpenPdfOptions = {}): Promise<OpenedPdf> {
  const pdfjs = await loadPdfJs();
  const stats: RangeReadStats = { requests: 0, bytesRead: 0, largestRead: 0, readMs: 0, pending: 0, failures: 0, lastError: null };
  let blob = initialBlob;

  async function readRange(begin: number, end: number): Promise<ArrayBuffer> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
      try {
        const buffer = await blob.slice(begin, end).arrayBuffer();
        if (buffer.byteLength !== end - begin) throw new Error(`short read: ${buffer.byteLength} of ${end - begin} bytes`);
        return buffer;
      } catch (error) {
        lastError = error;
        const message = `Reading bytes ${begin}–${end} failed (attempt ${attempt}): ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
        stats.failures += 1;
        stats.lastError = message;
        options.onReadError?.(message);
        if (options.reacquire && attempt < READ_ATTEMPTS) {
          try { blob = await options.reacquire(); } catch { /* keep the old one */ }
        }
      }
    }
    throw lastError;
  }

  class BlobRangeTransport extends pdfjs.PDFDataRangeTransport {
    override requestDataRange(begin: number, end: number): void {
      const started = performance.now();
      stats.pending += 1;
      readRange(begin, end).then((buffer) => {
        stats.pending -= 1;
        stats.requests += 1;
        stats.bytesRead += buffer.byteLength;
        stats.largestRead = Math.max(stats.largestRead, buffer.byteLength);
        stats.readMs += performance.now() - started;
        this.onDataRange(begin, new Uint8Array(buffer));
      }, (error: unknown) => {
        stats.pending -= 1;
        options.onFatal?.(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
        this.abort();
      });
    }
  }

  const transport = new BlobRangeTransport(blob.size, null);
  const folder = (name: string) => new URL(`${name}/`, runtimeBase).href;
  const task: PDFDocumentLoadingTask = pdfjs.getDocument({
    range: transport,
    rangeChunkSize: RANGE_CHUNK_BYTES,
    disableAutoFetch: true,
    disableStream: true,
    wasmUrl: folder("wasm"),
    iccUrl: folder("iccs"),
    standardFontDataUrl: folder("standard_fonts"),
    enableXfa: false,
  });
  const document = await task.promise;
  return { document, stats, close: () => task.destroy() };
}

/** Width of the quick bitmap of each page shown while moving (px). */
const LOW_RES_WIDTH = 900;
/** Quick bitmaps kept; the plan allows three or four. */
const LOW_RES_KEEP = 4;
/** Decoded pages kept loaded, so redrawing a page reuses its decoded images. */
const PAGES_KEEP = 3;
/** Largest sharp render, in pixels (stays well inside Safari's canvas limits). */
const MAX_RENDER_PIXELS = 12_000_000;
/** A render still running after this long is given up, so one stuck page cannot stop the rest. */
const RENDER_TIMEOUT_MS = 20_000;

export interface PdfPageSourceOptions extends OpenPdfOptions {
  /** Page sizes from an earlier open, to skip measuring every page. */
  knownSizes?: PageSize[] | null;
  /** Called when a quick page bitmap becomes ready, so the view can redraw. */
  onUpdate?: () => void;
  /** A page took too long to render and was skipped. */
  onStall?: (index: number) => void;
}

export interface PdfPageSource extends PageSource {
  readonly sizes: PageSize[];
}

interface Job {
  index: number;
  region: PageRegion;
  width: number;
  height: number;
  sharp: boolean;
  resolve: (canvas: HTMLCanvasElement | null) => void;
}

/**
 * A PDF as a Copy-mode page source. One render runs at a time; quick page
 * bitmaps for what is on screen come first, sharp regions after. Sharp
 * requests are cancelled as soon as the view moves on.
 */
export async function openPdfPageSource(blob: Blob, runtimeBase: URL, options: PdfPageSourceOptions = {}): Promise<PdfPageSource> {
  const opened = await openPdfBlob(blob, runtimeBase, options);
  const document = opened.document;
  const count = document.numPages;

  const pages = new Map<number, PDFPageProxy>();
  async function page(index: number): Promise<PDFPageProxy> {
    const cached = pages.get(index);
    if (cached) {
      pages.delete(index);
      pages.set(index, cached);
      return cached;
    }
    const loaded = await document.getPage(index + 1);
    pages.set(index, loaded);
    while (pages.size > PAGES_KEEP) {
      const [oldest, proxy] = pages.entries().next().value as [number, PDFPageProxy];
      pages.delete(oldest);
      proxy.cleanup();
    }
    return loaded;
  }

  let sizes: PageSize[];
  const known = options.knownSizes;
  if (known && known.length === count && known.every((size) => size.width > 0 && size.height > 0)) {
    sizes = known.map((size) => ({ ...size }));
  } else {
    sizes = [];
    for (let index = 0; index < count; index += 1) {
      const proxy = await document.getPage(index + 1);
      const viewport = proxy.getViewport({ scale: 1 });
      sizes.push({ width: viewport.width, height: viewport.height });
    }
  }

  const lowRes = new Map<number, HTMLCanvasElement>();
  const lowResPending = new Set<number>();
  const queue: Job[] = [];
  let running: { job: Job; task: RenderTask | null } | null = null;
  let disposed = false;

  function rememberLowRes(index: number, canvas: HTMLCanvasElement): void {
    lowRes.delete(index);
    lowRes.set(index, canvas);
    while (lowRes.size > LOW_RES_KEEP) {
      const oldest = lowRes.keys().next().value as number;
      const dropped = lowRes.get(oldest)!;
      lowRes.delete(oldest);
      dropped.width = 0;
      dropped.height = 0;
    }
  }

  async function renderJob(job: Job): Promise<HTMLCanvasElement | null> {
    const proxy = await page(job.index);
    const regionWidth = Math.max(1e-6, job.region.u1 - job.region.u0);
    const pageWidthPx = job.width / regionWidth;
    const base = proxy.getViewport({ scale: 1 });
    const viewport = proxy.getViewport({ scale: pageWidthPx / base.width });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(job.width));
    canvas.height = Math.max(1, Math.round(job.height));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const task = proxy.render({
      canvas,
      viewport,
      transform: [1, 0, 0, 1, -job.region.u0 * viewport.width, -job.region.v0 * viewport.height],
    });
    if (running) running.task = task;
    try {
      await task.promise;
      return canvas;
    } catch (error) {
      if (error instanceof Error && error.name === "RenderingCancelledException") return null;
      throw error;
    }
  }

  async function pump(): Promise<void> {
    if (running || disposed) return;
    // Quick bitmaps first: they are what makes moving feel immediate.
    const nextIndex = queue.findIndex((job) => !job.sharp);
    const job = queue.splice(nextIndex >= 0 ? nextIndex : 0, 1)[0];
    if (!job) return;
    running = { job, task: null };
    const current = running;
    let result: HTMLCanvasElement | null = null;
    let timer: number | undefined;
    try {
      result = await Promise.race([
        renderJob(job),
        new Promise<null>((resolve) => {
          timer = window.setTimeout(() => {
            current.task?.cancel();
            options.onStall?.(job.index);
            resolve(null);
          }, RENDER_TIMEOUT_MS);
        }),
      ]);
    } catch {
      result = null;
    } finally {
      window.clearTimeout(timer);
    }
    running = null;
    job.resolve(disposed ? null : result);
    void pump();
  }

  function enqueue(job: Omit<Job, "resolve">): Promise<HTMLCanvasElement | null> {
    return new Promise((resolve) => {
      queue.push({ ...job, resolve });
      void pump();
    });
  }

  function requestLowRes(index: number): void {
    if (lowRes.has(index) || lowResPending.has(index) || disposed) return;
    lowResPending.add(index);
    const size = sizes[index];
    const width = LOW_RES_WIDTH;
    const height = Math.round(width * (size.height / size.width));
    void enqueue({ index, region: { u0: 0, v0: 0, u1: 1, v1: 1 }, width, height, sharp: false }).then((canvas) => {
      lowResPending.delete(index);
      if (canvas) {
        rememberLowRes(index, canvas);
        options.onUpdate?.();
      }
    });
  }

  return {
    pageCount: count,
    sizes,
    pageSize: (index) => sizes[index],
    draw(context, index, x, y, width, height) {
      const bitmap = lowRes.get(index);
      if (bitmap) {
        lowRes.delete(index);
        lowRes.set(index, bitmap);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(bitmap, x, y, width, height);
        return;
      }
      context.fillStyle = "#f1eee8";
      context.fillRect(x, y, width, height);
      requestLowRes(index);
    },
    renderRegion(index, region, widthPx, heightPx) {
      // Keep within the canvas budget by lowering resolution, not by cropping.
      const factor = Math.min(1, Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, widthPx * heightPx)));
      return enqueue({ index, region, width: widthPx * factor, height: heightPx * factor, sharp: true });
    },
    cancelRegions() {
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (queue[index].sharp) queue.splice(index, 1)[0].resolve(null);
      }
      if (running?.job.sharp) running.task?.cancel();
    },
    dispose() {
      disposed = true;
      for (const job of queue.splice(0)) job.resolve(null);
      running?.task?.cancel();
      for (const canvas of lowRes.values()) { canvas.width = 0; canvas.height = 0; }
      lowRes.clear();
      pages.clear();
      void opened.close();
    },
  };
}
