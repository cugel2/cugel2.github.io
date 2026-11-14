/**
 * Copy mode: a reference pane (finger pans and pinches) and a drawing pane
 * (Pencil draws), each with a frame of the same size. Self-contained: main.ts
 * only shows and hides it and passes shared services in. No target, score or
 * trial record.
 */
import type { Handedness } from "../core/types";
import { COPY_FALLBACK_WIDTH_MM, COPY_WIDTH_RANGE, drawVariableWidthStroke, pressureWidthsMm } from "../core/strokeRender";
import {
  addStroke, backToFrame, blink, canCompare, clearStrokes, fromFrameUnits, isOffFrame, newCopy, newSession, parseSession,
  setCompare, setView, startStroke, toFrameUnits, undoStroke, type CompareView, type CopyPoint, type CopySession, type CopyStroke,
} from "./copySession";
import {
  clampView, fitPage, layoutPages, moveView, pageAt, pageTiles, sameView, viewHeight, zoomAbout,
  type DocLayout, type DocRect, type FrameSize, type Point, type View,
} from "./docSpace";
import { GestureTracker } from "./gestures";
import { addBook, bookKindOf, getBook, listBooks, loadCurrentCopy, removeBook, saveCurrentCopy, updateBook, type BookMeta } from "./library";
import { imageSource, type PageSource } from "./pageSource";
import { openPdfPageSource } from "./pdfSource";

export interface CopyElements {
  stage: HTMLElement;
  referencePane: HTMLElement;
  drawingPane: HTMLElement;
  referenceCanvas: HTMLCanvasElement;
  drawingCanvas: HTMLCanvasElement;
  fileInput: HTMLInputElement;
  emptyState: HTMLElement;
  referenceBar: HTMLElement;
  drawingBar: HTMLElement;
  drawTools: HTMLElement;
  bookName: HTMLElement;
  backToFrameButton: HTMLButtonElement;
  compareBar: HTMLElement;
  compareButtons: HTMLButtonElement[];
  opacityInput: HTMLInputElement;
  tintButton: HTMLButtonElement;
  undoButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
  newButton: HTMLButtonElement;
  compareButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
  saveDialog: HTMLDialogElement;
  saveDrawingButton: HTMLButtonElement;
  saveSideBySideButton: HTMLButtonElement;
  saveNote: HTMLElement;
  savePreview: HTMLElement;
  savePreviewImage: HTMLImageElement;
  saveDownloadLink: HTMLAnchorElement;
  pageButton: HTMLButtonElement;
  libraryButton: HTMLButtonElement;
  libraryDialog: HTMLDialogElement;
  libraryList: HTMLElement;
  libraryNote: HTMLElement;
}

export interface CopyServices {
  pxPerMm(): number;
  handedness(): Handedness;
  /** A stroke started (ended = false) or ended (true): counts toward practice time. */
  onActivity(ended: boolean): void;
  showToast(message: string): void;
  setStatus(text: string): void;
}

export interface CopyView {
  show(): void;
  hide(): void;
  isDrawing(): boolean;
  setHandedness(): void;
  setTime(text: string): void;
}

/** Room at the top of each pane for its bar, and padding around the frame (CSS px). */
const PANE_TOP = 60;
const PANE_PAD = 16;
const SAVE_LONG_SIDE_PX = 2000;
const AUTOSAVE_DELAY_MS = 400;
const TINT = [21, 87, 192] as const;
/** Luminance at and above which the reference counts as paper when tinted. */
const TINT_PAPER_LEVEL = 225;
/** Wait this long after the view stops moving before rendering it sharply (ms). */
const SHARPEN_DELAY_MS = 150;
const BACKDROP = "#ebe7de";
const DIM = "rgba(235, 231, 222, 0.78)";

interface FrameRect { left: number; top: number; width: number; height: number }

interface ActiveStroke {
  pointerId: number;
  points: CopyPoint[];
  keys: Set<string>;
}

interface Capture { original: HTMLCanvasElement; tinted: HTMLCanvasElement }

interface SharpTile { doc: DocRect; canvas: HTMLCanvasElement }

export function createCopyView(elements: CopyElements, services: CopyServices): CopyView {
  const referenceContext = context2d(elements.referenceCanvas);
  const drawingContext = context2d(elements.drawingCanvas);
  const baked = document.createElement("canvas");
  const bakedContext = context2d(baked);

  let visible = false;
  let loaded = false;
  let session: CopySession | null = null;
  let source: PageSource | null = null;
  let layout: DocLayout | null = null;
  let bookName = "";
  let bookId: string | null = null;
  /** Sharp renders of what is on screen, placed in document units. */
  let sharpTiles: SharpTile[] = [];
  let sharpTimer: number | undefined;
  let sharpGeneration = 0;
  let captureGeneration = 0;
  let bookSaveTimer: number | undefined;
  let frame: FrameRect = { left: 0, top: 0, width: 1, height: 1 };
  let paneSize = { width: 1, height: 1 };
  let capture: Capture | null = null;
  let active: ActiveStroke | null = null;
  let renderQueued = false;
  let saveTimer: number | undefined;
  let statusText = "";
  let timeText = "";
  const gestures = new GestureTracker();
  let mouseDrag: { pointerId: number; last: Point } | null = null;
  /** Files for Save to Photos, made when the dialog opens so the tap can share them at once. */
  let readyExports: { drawing: File; sideBySide: File | null } | null = null;

  // ----- layout -----

  function frameSize(): FrameSize {
    return { width: frame.width, height: frame.height };
  }

  /** Width / height of the space a frame can use in a pane. */
  function naturalAspect(): number {
    const width = Math.max(1, paneSize.width - 2 * PANE_PAD);
    const height = Math.max(1, paneSize.height - PANE_TOP - PANE_PAD);
    return width / height;
  }

  function measure(): void {
    elements.stage.dataset.hand = services.handedness().toLowerCase();
    const reference = elements.referencePane.getBoundingClientRect();
    const drawing = elements.drawingPane.getBoundingClientRect();
    paneSize = { width: Math.min(reference.width, drawing.width), height: Math.min(reference.height, drawing.height) };
    const pixelRatio = window.devicePixelRatio || 1;
    for (const [canvas, rect] of [[elements.referenceCanvas, reference], [elements.drawingCanvas, drawing]] as const) {
      canvas.width = Math.max(1, Math.round(rect.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(rect.height * pixelRatio));
    }
    // The frame follows the pane until the first stroke locks the copy; after
    // that it keeps its shape and the largest frame of that shape is fitted.
    if (session && !session.lockedView) session = { ...session, frameAspect: naturalAspect() };
    const aspect = session?.frameAspect ?? naturalAspect();
    const availableWidth = Math.max(1, paneSize.width - 2 * PANE_PAD);
    const availableHeight = Math.max(1, paneSize.height - PANE_TOP - PANE_PAD);
    const width = Math.min(availableWidth, availableHeight * aspect);
    const height = width / aspect;
    frame = {
      left: (paneSize.width - width) / 2,
      top: PANE_TOP + (availableHeight - height) / 2,
      width,
      height,
    };
    // Keep the view within the zoom limits for this frame (e.g. after rotating).
    if (session?.view && layout && !session.lockedView) session = setView(session, clampView(session.view, layout, frameSize()));
    rebuildCapture();
    rebake();
    scheduleSharpen();
  }

  // ----- drawing the document -----

  /** Draws the document as seen through `view` into a frame of `size`, at the context's origin. */
  function drawDocument(context: CanvasRenderingContext2D, view: View, size: FrameSize, extent: { left: number; top: number; right: number; bottom: number }): void {
    if (!source || !layout) return;
    const scale = size.width / view.w;
    for (let index = 0; index < source.pageCount; index += 1) {
      const x = (0 - view.x) * scale;
      const y = (layout.tops[index] - view.y) * scale;
      const width = scale;
      const height = layout.heights[index] * scale;
      if (x > extent.right || y > extent.bottom || x + width < extent.left || y + height < extent.top) continue;
      context.fillStyle = "#fff";
      context.fillRect(x, y, width, height);
      source.draw(context, index, x, y, width, height);
    }
  }

  function drawReferencePane(): void {
    const context = referenceContext;
    const pixelRatio = window.devicePixelRatio || 1;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = BACKDROP;
    context.fillRect(0, 0, paneSize.width, paneSize.height);
    if (!session?.view || !source) return;
    context.save();
    context.translate(frame.left, frame.top);
    drawDocument(context, session.view, frameSize(), { left: -frame.left, top: -frame.top, right: paneSize.width - frame.left, bottom: paneSize.height - frame.top });
    const scale = frame.width / session.view.w;
    for (const tile of sharpTiles) {
      context.drawImage(tile.canvas, (tile.doc.x - session.view.x) * scale, (tile.doc.y - session.view.y) * scale, tile.doc.w * scale, tile.doc.h * scale);
    }
    context.restore();
    // Dim everything outside the frame, so it is clear what will be compared.
    context.beginPath();
    context.rect(0, 0, paneSize.width, paneSize.height);
    context.rect(frame.left, frame.top, frame.width, frame.height);
    context.fillStyle = DIM;
    context.fill("evenodd");
    outlineFrame(context, session.lockedView && !isOffFrame(session) ? "#1557c0" : "#171717", isOffFrame(session));
  }

  function outlineFrame(context: CanvasRenderingContext2D, colour: string, dashed = false): void {
    context.save();
    context.strokeStyle = colour;
    context.lineWidth = 1.5;
    context.setLineDash(dashed ? [6, 5] : []);
    context.strokeRect(frame.left - 0.75, frame.top - 0.75, frame.width + 1.5, frame.height + 1.5);
    context.restore();
  }

  function drawDrawingPane(): void {
    const context = drawingContext;
    const pixelRatio = window.devicePixelRatio || 1;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = BACKDROP;
    context.fillRect(0, 0, paneSize.width, paneSize.height);
    context.fillStyle = "#fff";
    context.fillRect(frame.left, frame.top, frame.width, frame.height);
    if (session) {
      context.save();
      context.beginPath();
      context.rect(frame.left, frame.top, frame.width, frame.height);
      context.clip();
      context.translate(frame.left, frame.top);
      const compare = session.compare;
      if (compare === "REFERENCE" && capture) {
        context.drawImage(capture.original, 0, 0, frame.width, frame.height);
      } else {
        if (compare === "BOTH" && capture) {
          context.globalAlpha = session.bothOpacity;
          context.drawImage(session.tint ? capture.tinted : capture.original, 0, 0, frame.width, frame.height);
          context.globalAlpha = 1;
        }
        context.drawImage(baked, 0, 0, frame.width, frame.height);
        if (active) drawStroke(context, active.points, frame.width, 1);
      }
      context.restore();
    }
    outlineFrame(context, "#171717");
  }

  function render(): void {
    renderQueued = false;
    if (!visible) return;
    drawReferencePane();
    drawDrawingPane();
  }

  function requestRender(): void {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }

  // ----- strokes -----

  /** Draws a stroke stored in frame units into a frame `frameWidth` px wide; `widthScale` scales line widths (export). */
  function drawStroke(context: CanvasRenderingContext2D, points: readonly CopyPoint[], frameWidth: number, widthScale: number): void {
    if (points.length === 0) return;
    const pxPerMm = services.pxPerMm() * widthScale;
    const widths = pressureWidthsMm(points.map((point) => point.p), COPY_WIDTH_RANGE, COPY_FALLBACK_WIDTH_MM).map((mm) => mm * pxPerMm);
    drawVariableWidthStroke(context, points.map((point) => fromFrameUnits(point, frameWidth)), widths);
  }

  function rebake(): void {
    const pixelRatio = window.devicePixelRatio || 1;
    baked.width = Math.max(1, Math.round(frame.width * pixelRatio));
    baked.height = Math.max(1, Math.round(frame.height * pixelRatio));
    bakedContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    bakedContext.clearRect(0, 0, frame.width, frame.height);
    for (const stroke of session?.strokes ?? []) drawStroke(bakedContext, stroke.points, frame.width, 1);
  }

  // ----- compare capture -----

  /**
   * The locked framing at frame resolution, plus a copy with dark lines tinted
   * blue and paper made clear. Drawn at once from what is to hand, then, for a
   * PDF, replaced by a sharp render.
   */
  function rebuildCapture(): void {
    capture = null;
    captureGeneration += 1;
    if (!session?.lockedView || !source) return;
    const pixelRatio = window.devicePixelRatio || 1;
    const original = blankCanvas(frame.width * pixelRatio, frame.height * pixelRatio);
    const context = context2d(original);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    drawDocument(context, session.lockedView, frameSize(), { left: 0, top: 0, right: frame.width, bottom: frame.height });
    capture = { original, tinted: tintedCopy(original) };
    if (!source.renderRegion) return;
    const generation = captureGeneration;
    const view = session.lockedView;
    const sharp = blankCanvas(original.width, original.height);
    void renderView(context2d(sharp), view, { width: original.width, height: original.height }).then((complete) => {
      if (!complete || generation !== captureGeneration) return;
      capture = { original: sharp, tinted: tintedCopy(sharp) };
      requestRender();
    });
  }

  function tintedCopy(original: HTMLCanvasElement): HTMLCanvasElement {
    const tinted = blankCanvas(original.width, original.height, false);
    const pixels = context2d(original).getImageData(0, 0, original.width, original.height);
    const data = pixels.data;
    for (let index = 0; index < data.length; index += 4) {
      const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      data[index] = TINT[0];
      data[index + 1] = TINT[1];
      data[index + 2] = TINT[2];
      // Paper (light) goes clear and lines go blue, so tinted or cream paper adds no wash.
      data[index + 3] = Math.min(255, Math.max(0, ((TINT_PAPER_LEVEL - luminance) / TINT_PAPER_LEVEL) * 255 * 1.4));
    }
    context2d(tinted).putImageData(pixels, 0, 0);
    return tinted;
  }

  /**
   * Draws `view` sharply into a context `size` px across (no transform), page
   * part by page part. Resolves false if a render was cancelled. Images draw
   * directly.
   */
  async function renderView(context: CanvasRenderingContext2D, view: View, size: FrameSize): Promise<boolean> {
    if (!source || !layout) return false;
    const scale = size.width / view.w;
    if (!source.renderRegion) {
      drawDocument(context, view, size, { left: 0, top: 0, right: size.width, bottom: size.height });
      return true;
    }
    const rect = { x: view.x, y: view.y, w: view.w, h: viewHeight(view, size) };
    for (const tile of pageTiles(layout, rect)) {
      const width = Math.max(1, Math.round(tile.doc.w * scale));
      const height = Math.max(1, Math.round(tile.doc.h * scale));
      const canvas = await source.renderRegion(tile.index, tile.region, width, height);
      if (!canvas) return false;
      context.drawImage(canvas, (tile.doc.x - view.x) * scale, (tile.doc.y - view.y) * scale, tile.doc.w * scale, tile.doc.h * scale);
    }
    return true;
  }

  // ----- sharp rendering of the reference pane -----

  /** After the view settles, render what the reference pane shows at device resolution. */
  function scheduleSharpen(): void {
    window.clearTimeout(sharpTimer);
    sharpGeneration += 1;
    source?.cancelRegions?.();
    if (!source?.renderRegion || !session?.view || !visible) return;
    sharpTimer = window.setTimeout(() => void sharpen(), SHARPEN_DELAY_MS);
  }

  async function sharpen(): Promise<void> {
    if (!source?.renderRegion || !session?.view || !layout) return;
    const generation = sharpGeneration;
    const view = session.view;
    const scale = frame.width / view.w;
    const pixelRatio = window.devicePixelRatio || 1;
    const paneRect = {
      x: view.x - frame.left / scale,
      y: view.y - frame.top / scale,
      w: paneSize.width / scale,
      h: paneSize.height / scale,
    };
    const tiles: SharpTile[] = [];
    for (const tile of pageTiles(layout, paneRect)) {
      const width = Math.round(tile.doc.w * scale * pixelRatio);
      const height = Math.round(tile.doc.h * scale * pixelRatio);
      if (width < 4 || height < 4) continue;
      const canvas = await source.renderRegion(tile.index, tile.region, width, height);
      if (!canvas || generation !== sharpGeneration) {
        for (const done of tiles) releaseCanvas(done.canvas);
        return;
      }
      tiles.push({ doc: tile.doc, canvas });
    }
    for (const old of sharpTiles) releaseCanvas(old.canvas);
    sharpTiles = tiles;
    requestRender();
  }

  function dropSharpTiles(): void {
    for (const tile of sharpTiles) releaseCanvas(tile.canvas);
    sharpTiles = [];
  }

  // ----- state changes -----

  function update(next: CopySession, options: { save?: boolean; rebake?: boolean } = {}): void {
    const lockedBefore = session?.lockedView ?? null;
    const viewBefore = session?.view ?? null;
    session = next;
    if (session.lockedView !== lockedBefore) rebuildCapture();
    if (!sameView(viewBefore, session.view)) {
      scheduleSharpen();
      scheduleBookSave();
    }
    if (options.rebake) rebake();
    if (options.save !== false) scheduleSave();
    updateControls();
    requestRender();
  }

  /** Each book remembers where you were in it. */
  function scheduleBookSave(): void {
    window.clearTimeout(bookSaveTimer);
    const id = bookId;
    const view = session?.view;
    if (!id || !view) return;
    bookSaveTimer = window.setTimeout(() => void updateBook(id, { lastView: view }).catch(() => undefined), AUTOSAVE_DELAY_MS * 2);
  }

  function scheduleSave(): void {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      if (session) void saveCurrentCopy(session).catch(() => services.showToast("The copy could not be saved"));
    }, AUTOSAVE_DELAY_MS);
  }

  function updateControls(): void {
    const strokes = session?.strokes.length ?? 0;
    const comparing = session?.compare ?? null;
    elements.undoButton.disabled = strokes === 0;
    elements.clearButton.disabled = strokes === 0;
    elements.newButton.disabled = !session || (strokes === 0 && !session.lockedView);
    elements.compareButton.disabled = !session || !canCompare(session);
    elements.compareButton.setAttribute("aria-pressed", String(comparing !== null));
    elements.compareButton.textContent = comparing ? "Draw" : "Compare";
    elements.saveButton.disabled = strokes === 0;
    elements.compareBar.hidden = comparing === null;
    elements.drawTools.hidden = comparing !== null;
    elements.saveButton.hidden = comparing !== null;
    elements.drawingBar.hidden = source === null;
    for (const button of elements.compareButtons) button.setAttribute("aria-pressed", String(button.dataset.compare === comparing));
    elements.opacityInput.value = String(Math.round((session?.bothOpacity ?? 0.5) * 100));
    elements.opacityInput.disabled = comparing !== "BOTH";
    elements.tintButton.setAttribute("aria-pressed", String(session?.tint ?? true));
    elements.tintButton.disabled = comparing !== "BOTH";
    elements.backToFrameButton.hidden = !session || !isOffFrame(session);
    elements.emptyState.hidden = source !== null;
    elements.referenceBar.hidden = source === null;
    elements.bookName.textContent = bookName;
    const pages = source?.pageCount ?? 0;
    elements.pageButton.hidden = pages < 2;
    if (pages >= 2) elements.pageButton.textContent = `p. ${currentPage() + 1} / ${pages}`;
    updateStatus();
  }

  function updateStatus(): void {
    if (!source || !session) statusText = "Copy · choose a PDF or a picture to copy from";
    else if (session.compare === "MINE" || session.compare === "REFERENCE") statusText = "Comparing · tap the frame with the Pencil to flip";
    else if (session.compare === "BOTH") statusText = "Comparing · reference under your lines";
    else if (!session.lockedView) statusText = "Copy · frame the reference with a finger, then draw";
    else if (isOffFrame(session)) statusText = "Copy · moved: Compare uses the framing of your first stroke";
    else statusText = `Copy · ${session.strokes.length} ${session.strokes.length === 1 ? "stroke" : "strokes"}`;
    services.setStatus(timeText ? `${statusText} · ${timeText}` : statusText);
  }

  // ----- loading -----

  function currentPage(): number {
    if (!layout || !session?.view) return 0;
    return pageAt(layout, session.view.y + viewHeight(session.view, frameSize()) / 2);
  }

  /** Opens a stored book or picture as the reference. Returns its record, or null if it is gone. */
  async function openBook(id: string): Promise<BookMeta | null> {
    const record = await getBook(id);
    if (!record) return null;
    const reacquire = async () => {
      const again = await getBook(id);
      if (!again) throw new Error("The book is no longer stored");
      return again.file;
    };
    let next: PageSource;
    if (record.kind === "pdf") {
      const knownSizes = Array.isArray(record.pageSizes) ? record.pageSizes : null;
      const pdf = await openPdfPageSource(record.file, new URL("./pdfjs/", document.baseURI), {
        reacquire,
        knownSizes,
        onUpdate: requestRender,
        onStall: (index) => services.showToast(`Page ${index + 1} is taking too long to draw`),
        onFatal: () => void recoverBook(id),
      });
      next = pdf;
      if (!knownSizes || knownSizes.length !== pdf.sizes.length) void updateBook(id, { pageSizes: pdf.sizes, pageCount: pdf.pageCount }).catch(() => undefined);
    } else {
      try {
        next = await imageSource(record.file);
      } catch {
        // Safari can lose track of a stored file; a fresh read usually works.
        next = await imageSource(await reacquire());
      }
    }
    source?.dispose();
    dropSharpTiles();
    source = next;
    bookId = id;
    bookName = record.name;
    layout = layoutPages(Array.from({ length: next.pageCount }, (_, index) => next.pageSize(index)));
    const { file: _file, ...meta } = record;
    void updateBook(id, { lastOpenedAt: Date.now() }).catch(() => undefined);
    return meta;
  }

  /**
   * The book could not be read (Safari lost the stored file). Open it again
   * under the same copy; give up after a few tries rather than loop.
   */
  let recoveries: number[] = [];
  async function recoverBook(id: string): Promise<void> {
    if (id !== bookId) return;
    const now = Date.now();
    recoveries = recoveries.filter((time) => now - time < 60_000);
    if (recoveries.length >= 2) {
      services.showToast("This book can't be read right now. Reopen it from Books…");
      return;
    }
    recoveries.push(now);
    try {
      if (!await openBook(id)) throw new Error("gone");
      rebuildCapture();
      scheduleSharpen();
      requestRender();
    } catch {
      services.showToast("This book can't be read right now. Reopen it from Books…");
    }
  }

  function closeSource(): void {
    source?.dispose();
    dropSharpTiles();
    source = null;
    layout = null;
    bookId = null;
    bookName = "";
    session = null;
    capture = null;
  }

  async function restore(): Promise<void> {
    loaded = true;
    try {
      const stored = parseSession(await loadCurrentCopy());
      if (stored?.bookId && await openBook(stored.bookId)) {
        // Reopen ready to draw, not mid-compare.
        session = { ...stored, compare: null };
        measure();
        if (!session.view && layout) session = setView(session, fitPage(layout, frameSize()));
      }
    } catch {
      services.showToast("The last copy could not be reopened");
    }
    measure();
    updateControls();
    requestRender();
    scheduleSharpen();
  }

  /** Starts a copy from a stored book, where you last were in it. */
  async function startFromBook(id: string): Promise<void> {
    if (session && session.bookId === id) return;
    if (session && session.strokes.length > 0 && !window.confirm("Start a new copy from this one? The current copy will be replaced.")) return;
    let meta: BookMeta | null;
    try {
      meta = await openBook(id);
    } catch {
      services.showToast("That file could not be opened");
      return;
    }
    if (!meta) {
      services.showToast("That file is no longer stored");
      return;
    }
    session = newSession(id, naturalAspect(), null);
    measure();
    const remembered = isStoredView(meta.lastView) ? clampView(meta.lastView, layout!, frameSize()) : fitPage(layout!, frameSize());
    update(setView(session, remembered), { rebake: true });
  }

  async function chooseFile(file: File): Promise<void> {
    const kind = bookKindOf(file);
    if (!kind) {
      services.showToast("Choose a PDF or a picture");
      return;
    }
    let id: string;
    try {
      id = (await addBook(file, kind)).id;
    } catch {
      services.showToast("That file could not be stored on this device");
      return;
    }
    void protectStorage();
    elements.libraryDialog.close();
    await startFromBook(id);
    void refreshLibrary();
  }

  // ----- library -----

  /** Ask Safari to keep stored books (it may otherwise clear them after weeks unused). */
  async function protectStorage(): Promise<void> {
    try { await navigator.storage?.persist?.(); } catch { /* not offered here */ }
  }

  async function storageNote(): Promise<string> {
    if (!navigator.storage?.persisted) return "Books are stored on this device only. This connection can't ask Safari to keep them; the app at its usual address can.";
    try {
      return (await navigator.storage.persisted())
        ? "Books are stored on this device only, and Safari will keep them."
        : "Books are stored on this device only. Safari may clear them if the app goes unused for a few weeks; adding Circle Trainer to the Home Screen keeps them.";
    } catch {
      return "Books are stored on this device only.";
    }
  }

  async function refreshLibrary(): Promise<void> {
    let books: BookMeta[];
    try {
      books = await listBooks();
    } catch {
      elements.libraryList.textContent = "The library could not be read.";
      return;
    }
    elements.libraryNote.textContent = await storageNote();
    elements.libraryList.replaceChildren();
    if (books.length === 0) {
      const empty = document.createElement("li");
      empty.className = "copy-library-empty";
      empty.textContent = "Nothing stored yet.";
      elements.libraryList.append(empty);
    }
    for (const book of books) {
      const item = document.createElement("li");
      const text = document.createElement("div");
      text.className = "copy-library-text";
      const name = document.createElement("strong");
      name.textContent = book.name;
      const details = document.createElement("span");
      const pages = book.kind === "pdf" && book.pageCount ? ` · ${book.pageCount} pages` : book.kind === "image" ? " · picture" : "";
      details.textContent = `${formatSize(book.size)}${pages} · opened ${formatDate(book.lastOpenedAt)}`;
      text.append(name, details);
      const open = document.createElement("button");
      open.type = "button";
      open.className = book.id === bookId ? "secondary-button" : "primary-button";
      open.textContent = book.id === bookId ? "Open now" : "Open";
      open.disabled = book.id === bookId;
      open.addEventListener("click", () => { elements.libraryDialog.close(); void startFromBook(book.id); });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger-button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => void removeFromLibrary(book));
      item.append(text, open, remove);
      elements.libraryList.append(item);
    }
  }

  async function removeFromLibrary(book: BookMeta): Promise<void> {
    const current = book.id === bookId;
    const warning = current ? " Your copy from it will be removed too." : "";
    if (!window.confirm(`Remove “${book.name}” from this device?${warning}`)) return;
    try {
      await removeBook(book.id);
      if (current) {
        closeSource();
        await saveCurrentCopy(null);
        measure();
        updateControls();
        requestRender();
      }
    } catch {
      services.showToast("It could not be removed");
    }
    await refreshLibrary();
  }

  function openLibrary(): void {
    void refreshLibrary();
    elements.libraryDialog.showModal();
  }

  function jumpToPage(): void {
    if (!source || !layout || !session) return;
    const answer = window.prompt(`Go to page (1–${source.pageCount})`, String(currentPage() + 1));
    if (answer === null) return;
    const page = Math.round(Number(answer));
    if (!Number.isFinite(page) || page < 1 || page > source.pageCount) {
      services.showToast(`Choose a page from 1 to ${source.pageCount}`);
      return;
    }
    update(setView(session, fitPage(layout, frameSize(), page - 1)));
  }

  // ----- reference pane input -----

  function paneToFrame(point: Point): Point {
    return { x: point.x - frame.left, y: point.y - frame.top };
  }

  function localPoint(event: PointerEvent | WheelEvent, element: HTMLElement): Point {
    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function moveReference(from: Point, to: Point, ratio: number): void {
    if (!session?.view || !layout) return;
    update(setView(session, moveView(session.view, layout, frameSize(), paneToFrame(from), paneToFrame(to), ratio)));
  }

  function onReferenceDown(event: PointerEvent): void {
    if (!session?.view) return;
    if (event.pointerType === "touch") {
      event.preventDefault();
      gestures.down(event.pointerId, localPoint(event, elements.referenceCanvas));
      capturePointer(elements.referenceCanvas, event.pointerId);
    } else if (event.pointerType === "mouse" && event.button === 0) {
      event.preventDefault();
      mouseDrag = { pointerId: event.pointerId, last: localPoint(event, elements.referenceCanvas) };
      capturePointer(elements.referenceCanvas, event.pointerId);
    }
    // The Pencil does nothing on the reference.
  }

  function onReferenceMove(event: PointerEvent): void {
    const point = localPoint(event, elements.referenceCanvas);
    if (event.pointerType === "touch") {
      const step = gestures.move(event.pointerId, point);
      if (step) moveReference(step.from, step.to, step.ratio);
    } else if (mouseDrag && event.pointerId === mouseDrag.pointerId) {
      const from = mouseDrag.last;
      mouseDrag.last = point;
      moveReference(from, point, 1);
    }
  }

  function onReferenceUp(event: PointerEvent): void {
    if (event.pointerType === "touch") gestures.up(event.pointerId);
    if (mouseDrag?.pointerId === event.pointerId) mouseDrag = null;
  }

  function onReferenceWheel(event: WheelEvent): void {
    if (!session?.view || !layout) return;
    event.preventDefault();
    const point = localPoint(event, elements.referenceCanvas);
    if (event.ctrlKey || event.metaKey) {
      // Trackpad pinches arrive as wheel events with ctrlKey; ⌘ or Ctrl + wheel zooms with a mouse.
      const ratio = Math.exp(-event.deltaY * (event.ctrlKey && Math.abs(event.deltaY) < 50 ? 0.01 : 0.0015));
      update(setView(session, zoomAbout(session.view, layout, frameSize(), paneToFrame(point), ratio)));
    } else {
      // Scrolling moves through the pages, as dragging does.
      moveReference(point, { x: point.x - event.deltaX, y: point.y - event.deltaY }, 1);
    }
  }

  // ----- drawing pane input -----

  function insideFrame(point: Point): boolean {
    return point.x >= 0 && point.y >= 0 && point.x <= frame.width && point.y <= frame.height;
  }

  function appendSamples(event: PointerEvent): void {
    if (!active) return;
    const rect = elements.drawingCanvas.getBoundingClientRect();
    const events = typeof event.getCoalescedEvents === "function" && event.getCoalescedEvents().length > 0 ? event.getCoalescedEvents() : [event];
    for (const sample of events) {
      const key = `${sample.clientX}|${sample.clientY}|${sample.timeStamp}`;
      if (active.keys.has(key)) continue;
      active.keys.add(key);
      const x = sample.clientX - rect.left - frame.left;
      const y = sample.clientY - rect.top - frame.top;
      active.points.push(toFrameUnits(x, y, frame.width, Number.isFinite(sample.pressure) ? sample.pressure : undefined));
    }
  }

  function onDrawingDown(event: PointerEvent): void {
    // Fingers do nothing here, so a resting palm is ignored.
    if (event.pointerType === "touch" || !session || !source) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Every Pencil touch-down here is ours, so Safari never starts a text selection from it.
    event.preventDefault();
    const point = paneToFrame(localPoint(event, elements.drawingCanvas));
    if (session.compare) {
      event.preventDefault();
      if (insideFrame(point)) update(blink(session), { save: false });
      return;
    }
    if (active || !insideFrame(point)) return;
    const next = startStroke(session);
    if (!next) return;
    event.preventDefault();
    update(next, { save: false });
    active = { pointerId: event.pointerId, points: [], keys: new Set() };
    capturePointer(elements.drawingCanvas, event.pointerId);
    appendSamples(event);
    services.onActivity(false);
    requestRender();
  }

  function onDrawingMove(event: PointerEvent): void {
    if (!active || event.pointerId !== active.pointerId) return;
    event.preventDefault();
    appendSamples(event);
    requestRender();
  }

  function onDrawingEnd(event: PointerEvent, cancelled: boolean): void {
    if (!active || event.pointerId !== active.pointerId || !session) return;
    event.preventDefault();
    if (!cancelled) appendSamples(event);
    const stroke: CopyStroke = { points: active.points };
    active = null;
    drawStroke(bakedContext, stroke.points, frame.width, 1);
    update(addStroke(session, stroke));
    services.onActivity(true);
  }

  // ----- toolbar -----

  function undo(): void {
    if (session) update(undoStroke(session), { rebake: true });
  }

  function clearAll(): void {
    if (!session || session.strokes.length === 0) return;
    if (!window.confirm("Clear every stroke of this copy?")) return;
    update(clearStrokes(session), { rebake: true });
  }

  function startNewCopy(): void {
    if (!session) return;
    if (session.strokes.length > 0 && !window.confirm("Start a new copy? This one will be replaced.")) return;
    session = newCopy(session, naturalAspect());
    measure();
    update(session, { rebake: true });
  }

  function toggleCompare(): void {
    if (!session) return;
    update(setCompare(session, session.compare ? null : "BOTH"), { save: false });
  }

  // ----- Save to Photos -----

  function exportAspect(): number {
    return frame.width / frame.height;
  }

  async function renderExports(): Promise<{ drawing: File; sideBySide: File | null }> {
    if (!session) throw new Error("No copy");
    const aspect = exportAspect();
    const width = aspect >= 1 ? SAVE_LONG_SIDE_PX : Math.round(SAVE_LONG_SIDE_PX * aspect);
    const height = Math.round(width / aspect);
    const widthScale = width / frame.width;
    const drawing = document.createElement("canvas");
    drawing.width = width;
    drawing.height = height;
    const context = context2d(drawing);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    for (const stroke of session.strokes) drawStroke(context, stroke.points, width, widthScale);

    let sideBySide: HTMLCanvasElement | null = null;
    if (session.lockedView && source) {
      const gap = Math.round(width * 0.04);
      sideBySide = document.createElement("canvas");
      sideBySide.width = width * 2 + gap;
      sideBySide.height = height;
      const both = context2d(sideBySide);
      both.fillStyle = "#fff";
      both.fillRect(0, 0, sideBySide.width, height);
      // Same sides as in the app: drawing on the drawing hand's side.
      const drawingLeft = services.handedness() === "LEFT";
      both.drawImage(drawing, drawingLeft ? 0 : width + gap, 0);
      both.save();
      both.translate(drawingLeft ? width + gap : 0, 0);
      both.beginPath();
      both.rect(0, 0, width, height);
      both.clip();
      drawDocument(both, session.lockedView, { width, height }, { left: 0, top: 0, right: width, bottom: height });
      both.restore();
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `${(bookName || "copy").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "copy"}-${stamp}`;
    return {
      drawing: new File([await toPng(drawing)], `${base}.png`, { type: "image/png" }),
      sideBySide: sideBySide ? new File([await toPng(sideBySide)], `${base}-side-by-side.png`, { type: "image/png" }) : null,
    };
  }

  function openSaveDialog(): void {
    if (!session || session.strokes.length === 0) return;
    readyExports = null;
    hidePreview();
    elements.saveDrawingButton.disabled = true;
    elements.saveSideBySideButton.disabled = true;
    elements.saveNote.textContent = "Preparing the image…";
    renderExports().then((files) => {
      readyExports = files;
      elements.saveDrawingButton.disabled = false;
      elements.saveSideBySideButton.disabled = files.sideBySide === null;
      elements.saveNote.textContent = canShareFiles(files.drawing)
        ? "Opens the share sheet. Choose “Save Image” to put it in Photos."
        : "Choose one, then press and hold the picture to save it.";
    }, () => { elements.saveNote.textContent = "The image could not be made."; });
    elements.saveDialog.showModal();
  }

  /** Runs synchronously in the tap handler: Safari opens the share sheet only from a user gesture. */
  function shareExport(which: "drawing" | "sideBySide"): void {
    const file = readyExports ? (which === "drawing" ? readyExports.drawing : readyExports.sideBySide) : null;
    if (!file) return;
    if (canShareFiles(file)) {
      navigator.share({ files: [file] }).then(() => elements.saveDialog.close(), (error: unknown) => {
        // Cancelling the share sheet rejects with AbortError; that is not a failure.
        if (!(error instanceof DOMException && error.name === "AbortError")) services.showToast("The share sheet could not open");
      });
    } else {
      showPreview(file);
    }
  }

  /**
   * Without file sharing (plain-http dev server, desktop browsers) show the
   * picture: on the iPad, press and hold it to "Save to Photos".
   */
  function showPreview(file: File): void {
    hidePreview();
    // A data: URL, not a blob: one: Safari may not offer to save blob images.
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      elements.savePreviewImage.src = reader.result;
      elements.saveDownloadLink.href = reader.result;
      elements.saveDownloadLink.download = file.name;
      elements.savePreview.hidden = false;
    };
    reader.readAsDataURL(file);
  }

  function hidePreview(): void {
    elements.savePreview.hidden = true;
    elements.savePreviewImage.removeAttribute("src");
    elements.saveDownloadLink.removeAttribute("href");
  }

  // ----- wiring -----

  elements.referenceCanvas.addEventListener("pointerdown", onReferenceDown);
  elements.referenceCanvas.addEventListener("pointermove", onReferenceMove);
  elements.referenceCanvas.addEventListener("pointerup", onReferenceUp);
  elements.referenceCanvas.addEventListener("pointercancel", onReferenceUp);
  elements.referenceCanvas.addEventListener("wheel", onReferenceWheel, { passive: false });
  elements.drawingCanvas.addEventListener("pointerdown", onDrawingDown);
  elements.drawingCanvas.addEventListener("pointermove", onDrawingMove);
  elements.drawingCanvas.addEventListener("pointerup", (event) => onDrawingEnd(event, false));
  elements.drawingCanvas.addEventListener("pointercancel", (event) => onDrawingEnd(event, true));
  for (const canvas of [elements.referenceCanvas, elements.drawingCanvas]) canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  // Safari's own pinch-zoom would fight the reference pinch, so block it over
  // the two panes only. Elsewhere (the toolbar) it stays, so a page that did
  // get zoomed can always be pinched back out.
  document.addEventListener("gesturestart", (event) => {
    if (visible && event.target instanceof Node && elements.stage.contains(event.target)) event.preventDefault();
  });

  elements.fileInput.addEventListener("change", () => {
    const file = elements.fileInput.files?.[0];
    elements.fileInput.value = "";
    if (file) void chooseFile(file);
  });
  elements.backToFrameButton.addEventListener("click", () => { if (session) update(backToFrame(session)); });
  elements.undoButton.addEventListener("click", undo);
  elements.clearButton.addEventListener("click", clearAll);
  elements.newButton.addEventListener("click", startNewCopy);
  elements.compareButton.addEventListener("click", toggleCompare);
  for (const button of elements.compareButtons) {
    button.addEventListener("click", () => { if (session) update(setCompare(session, button.dataset.compare as CompareView), { save: false }); });
  }
  elements.opacityInput.addEventListener("input", () => {
    if (session) update({ ...session, bothOpacity: Number(elements.opacityInput.value) / 100 });
  });
  elements.tintButton.addEventListener("click", () => { if (session) update({ ...session, tint: !session.tint }); });
  elements.saveButton.addEventListener("click", openSaveDialog);
  elements.saveDrawingButton.addEventListener("click", () => shareExport("drawing"));
  elements.saveSideBySideButton.addEventListener("click", () => shareExport("sideBySide"));
  elements.saveDialog.addEventListener("close", hidePreview);
  elements.libraryButton.addEventListener("click", openLibrary);
  elements.pageButton.addEventListener("click", jumpToPage);

  new ResizeObserver(() => { if (visible && !active) { measure(); requestRender(); } }).observe(elements.stage);

  return {
    show() {
      visible = true;
      elements.stage.hidden = false;
      measure();
      updateControls();
      requestRender();
      if (!loaded) void restore();
    },
    hide() {
      visible = false;
      elements.stage.hidden = true;
      window.clearTimeout(sharpTimer);
      source?.cancelRegions?.();
      gestures.clear();
      mouseDrag = null;
      active = null;
      if (session) void saveCurrentCopy(session).catch(() => undefined);
    },
    isDrawing: () => active !== null,
    setHandedness() {
      if (!visible) return;
      measure();
      requestRender();
    },
    setTime(text: string) {
      timeText = text;
      if (visible) updateStatus();
    },
  };
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable in this browser");
  return context;
}

function blankCanvas(width: number, height: number, white = true): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  if (white) {
    const context = context2d(canvas);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function isStoredView(value: unknown): value is View {
  const view = value as View | null;
  return !!view && [view.x, view.y, view.w].every(Number.isFinite) && view.w > 0;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function capturePointer(element: HTMLElement, pointerId: number): void {
  try { element.setPointerCapture(pointerId); } catch { /* the pointer already ended */ }
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))), "image/png"));
}

function canShareFiles(file: File): boolean {
  return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
}
