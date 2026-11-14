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
import { clampView, fitPage, layoutPages, moveView, zoomAbout, type DocLayout, type FrameSize, type Point, type View } from "./docSpace";
import { GestureTracker } from "./gestures";
import { addBook, bookKindOf, getBook, loadCurrentCopy, saveCurrentCopy } from "./library";
import { imageSource, type PageSource } from "./pageSource";

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
const BACKDROP = "#ebe7de";
const DIM = "rgba(235, 231, 222, 0.78)";

interface FrameRect { left: number; top: number; width: number; height: number }

interface ActiveStroke {
  pointerId: number;
  points: CopyPoint[];
  keys: Set<string>;
}

interface Capture { original: HTMLCanvasElement; tinted: HTMLCanvasElement }

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

  /** The locked framing at frame resolution, plus a copy with dark lines tinted blue and paper made clear. */
  function rebuildCapture(): void {
    capture = null;
    if (!session?.lockedView || !source) return;
    const pixelRatio = window.devicePixelRatio || 1;
    const original = document.createElement("canvas");
    original.width = Math.max(1, Math.round(frame.width * pixelRatio));
    original.height = Math.max(1, Math.round(frame.height * pixelRatio));
    const context = context2d(original);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, frame.width, frame.height);
    drawDocument(context, session.lockedView, frameSize(), { left: 0, top: 0, right: frame.width, bottom: frame.height });
    const tinted = document.createElement("canvas");
    tinted.width = original.width;
    tinted.height = original.height;
    const pixels = context.getImageData(0, 0, original.width, original.height);
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
    capture = { original, tinted };
  }

  // ----- state changes -----

  function update(next: CopySession, options: { save?: boolean; rebake?: boolean } = {}): void {
    const lockedBefore = session?.lockedView ?? null;
    session = next;
    if (session.lockedView !== lockedBefore) rebuildCapture();
    if (options.rebake) rebake();
    if (options.save !== false) scheduleSave();
    updateControls();
    requestRender();
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
    updateStatus();
  }

  function updateStatus(): void {
    if (!source || !session) statusText = "Copy · choose a picture to copy from";
    else if (session.compare === "MINE" || session.compare === "REFERENCE") statusText = "Comparing · tap the frame with the Pencil to flip";
    else if (session.compare === "BOTH") statusText = "Comparing · reference under your lines";
    else if (!session.lockedView) statusText = "Copy · frame the reference with a finger, then draw";
    else if (isOffFrame(session)) statusText = "Copy · moved: Compare uses the framing of your first stroke";
    else statusText = `Copy · ${session.strokes.length} ${session.strokes.length === 1 ? "stroke" : "strokes"}`;
    services.setStatus(timeText ? `${statusText} · ${timeText}` : statusText);
  }

  // ----- loading -----

  async function openImageBook(id: string): Promise<boolean> {
    let record = await getBook(id);
    if (!record) return false;
    let next: PageSource;
    try {
      next = await imageSource(record.file);
    } catch {
      // Safari can lose track of a stored file; a fresh read usually works.
      record = await getBook(id);
      if (!record) return false;
      next = await imageSource(record.file);
    }
    source?.dispose();
    source = next;
    bookName = record.name;
    layout = layoutPages([source.pageSize(0)]);
    return true;
  }

  async function restore(): Promise<void> {
    loaded = true;
    try {
      const stored = parseSession(await loadCurrentCopy());
      if (stored?.bookId && await openImageBook(stored.bookId)) {
        session = stored;
        measure();
        if (!session.view && layout) session = setView(session, fitPage(layout, frameSize()));
      }
    } catch {
      services.showToast("The last copy could not be reopened");
    }
    measure();
    updateControls();
    requestRender();
  }

  async function chooseFile(file: File): Promise<void> {
    if (bookKindOf(file) !== "image") {
      services.showToast("Choose a picture (PDFs come in the next version)");
      return;
    }
    if (session && session.strokes.length > 0 && !window.confirm("Start a new copy from this picture? The current one will be replaced.")) return;
    let bookId: string;
    try {
      bookId = (await addBook(file, "image")).id;
      if (!await openImageBook(bookId)) throw new Error("not stored");
    } catch {
      services.showToast("That picture could not be opened");
      return;
    }
    session = newSession(bookId, naturalAspect(), null);
    measure();
    update(setView(session, fitPage(layout!, frameSize())), { rebake: true });
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
    const at = paneToFrame(localPoint(event, elements.referenceCanvas));
    // Trackpad pinches arrive as wheel events with ctrlKey and small deltas.
    const ratio = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
    update(setView(session, zoomAbout(session.view, layout, frameSize(), at, ratio)));
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

function capturePointer(element: HTMLElement, pointerId: number): void {
  try { element.setPointerCapture(pointerId); } catch { /* the pointer already ended */ }
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))), "image/png"));
}

function canShareFiles(file: File): boolean {
  return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
}
