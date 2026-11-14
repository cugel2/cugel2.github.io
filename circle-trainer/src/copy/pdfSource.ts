/**
 * PDF.js loading for Copy mode. PDF.js is imported only when a PDF is opened,
 * and the file is read lazily: PDF.js asks for byte ranges and we answer each
 * with `blob.slice(begin, end).arrayBuffer()`, so a large book is never held
 * in memory as one buffer.
 *
 * Uses the legacy build: PDF.js lists Safari only under its legacy build.
 */
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

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
      }, () => {
        stats.pending -= 1;
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
