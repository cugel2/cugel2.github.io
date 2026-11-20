/**
 * The drawing pane: one sheet fitted into the pane, drawn with the block's
 * brush (p5.brush). Pencil only: a resting palm or finger does nothing.
 *
 * The sheet's canvas is made at the sheet's own size and shown scaled to fit,
 * so a rotation never redraws or shifts it, and the Pencil is mapped through
 * where the canvas actually is on screen. Blind contour hides the canvas
 * (strokes still go onto it); Peek shows it for a moment.
 */
import type { Medium } from "../core/brushes";
import { fitSheet, packStroke, type Sample, type Sheet } from "../core/sheet";
import { quantize, StrokePieces, strokeSeed } from "../core/strokePieces";
import { clearTo, createTarget, DEFAULT_SHEET_WIDTH, dispose, pieceDrawer, render, replaySheet, setLive, sheetMedium } from "./brushRender";

export interface DrawingHost {
  /** The sheet to draw on, made on first touch if there is none. Null refuses the stroke. */
  sheetForStroke(aspect: number, widthPx: number): Sheet | null;
  /** Called with the finished stroke already appended to the sheet. */
  strokeAdded(sheet: Sheet): void;
  refused(): void;
}

export interface DrawingPane {
  /** Shows `sheet`, or a blank sheet of `medium`'s paper when null. */
  setSheet(sheet: Sheet | null, medium: Medium): void;
  setBlind(blind: boolean): void;
  peek(ms: number): void;
  /** Draws the current sheet again from its strokes (after Undo). */
  redraw(): void;
}

const MARGIN = 14;
/** Canvas resolution: enough for the iPad's screen without wasting memory. */
const DENSITY = Math.min(2, window.devicePixelRatio || 1);

export function mountDrawing(pane: HTMLElement, host: DrawingHost): DrawingPane {
  const paper = document.createElement("div");
  paper.className = "sheet-paper";
  pane.prepend(paper);
  let canvas: HTMLCanvasElement | null = null;
  let size = { width: 0, height: 0 };
  let sheet: Sheet | null = null;
  let medium: Medium | null = null;
  let blind = false;
  let peekTimer = 0;
  let active: { id: number; samples: Sample[]; pieces: StrokePieces; sheet: Sheet } | null = null;

  function paneSize() {
    const box = pane.getBoundingClientRect();
    return { w: box.width, h: box.height };
  }

  /** Lays the sheet out to fit the pane, keeping its own drawing size. */
  function layout(): void {
    if (!canvas) return;
    const { w, h } = paneSize();
    const fit = fitSheet(size.height / size.width, w, h, MARGIN);
    for (const el of [paper, canvas]) {
      el.style.left = `${fit.left}px`;
      el.style.top = `${fit.top}px`;
      el.style.width = `${fit.width}px`;
      el.style.height = `${fit.height}px`;
    }
  }

  /** A fresh canvas of the given size, made p5.brush's target. */
  function makeCanvas(width: number, height: number): void {
    if (canvas) dispose(canvas);
    canvas = createTarget(width, height, DENSITY, pane);
    canvas.className = "sheet-canvas";
    size = { width, height };
    setLive(canvas);
    attach(canvas);
    layout();
    showOrHide();
  }

  /** The size a new sheet would have in the pane as it is now. */
  function freshSize() {
    const { w, h } = paneSize();
    const width = Math.max(200, Math.round(w - MARGIN * 2));
    const height = Math.max(200, Math.round(h - MARGIN * 2));
    return { width, height };
  }

  function showOrHide(): void {
    if (canvas) canvas.style.visibility = blind ? "hidden" : "visible";
  }

  function toSheet(e: PointerEvent): { x: number; y: number } {
    const r = canvas!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: ((e.clientY - r.top) / r.width) };
  }

  function append(event: PointerEvent): void {
    if (!active) return;
    const list = typeof event.getCoalescedEvents === "function" && event.getCoalescedEvents().length ? event.getCoalescedEvents() : [event];
    for (const e of list) {
      const p = toSheet(e);
      const sample = quantize({
        x: p.x,
        y: p.y,
        pressure: e.pointerType === "mouse" ? undefined : e.pressure,
        altitude: (e as PointerEvent & { altitudeAngle?: number }).altitudeAngle,
        azimuth: (e as PointerEvent & { azimuthAngle?: number }).azimuthAngle,
        t: e.timeStamp,
      });
      const last = active.samples[active.samples.length - 1];
      if (last && last.x === sample.x && last.y === sample.y && last.pressure === sample.pressure) continue;
      active.samples.push(sample);
      active.pieces.add(sample);
    }
    render();
  }

  function attach(target: HTMLCanvasElement): void {
    target.style.touchAction = "none";
    target.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch") return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      if (active || target !== canvas) return;
      const chosen = host.sheetForStroke(size.height / size.width, size.width);
      if (!chosen) { host.refused(); return; }
      if (chosen !== sheet) {
        sheet = chosen;
        medium = sheetMedium(chosen);
      }
      const m = sheetMedium(chosen);
      const pieces = new StrokePieces(strokeSeed(chosen.id, chosen.strokes.length), pieceDrawer(m, size.width, size.height));
      active = { id: event.pointerId, samples: [], pieces, sheet: chosen };
      try { target.setPointerCapture(event.pointerId); } catch { /* ended already */ }
      append(event);
    });
    target.addEventListener("pointermove", (event) => {
      if (!active || event.pointerId !== active.id) return;
      event.preventDefault();
      append(event);
    });
    const end = (event: PointerEvent, cancelled: boolean) => {
      if (!active || event.pointerId !== active.id) return;
      event.preventDefault();
      if (!cancelled) append(event);
      const { samples, pieces, sheet: target2 } = active;
      active = null;
      pieces.finish();
      render();
      if (samples.length > 0) {
        target2.strokes = [...target2.strokes, packStroke(samples)];
        target2.updated = Date.now();
        host.strokeAdded(target2);
      }
    };
    target.addEventListener("pointerup", (e) => end(e, false));
    target.addEventListener("pointercancel", (e) => end(e, true));
    target.addEventListener("contextmenu", (e) => e.preventDefault());
    target.addEventListener("touchstart", (e) => { if (e.touches.length === 1) e.preventDefault(); }, { passive: false });
  }

  new ResizeObserver(() => {
    // The first time the pane has a size, make a blank sheet for it.
    if (!canvas && medium) { const s = freshSize(); makeCanvas(s.width, s.height); clearTo(medium.paper); }
    layout();
  }).observe(pane);

  return {
    setSheet(next, nextMedium) {
      if (active && active.sheet !== next) active = null;
      if (next && next === sheet && canvas) return;
      sheet = next;
      medium = next ? sheetMedium(next) : nextMedium;
      paper.style.background = medium.paper;
      const { w } = paneSize();
      if (next) {
        const width = next.widthPx ?? DEFAULT_SHEET_WIDTH;
        makeCanvas(width, Math.round(width * next.aspect));
        replaySheet(next, size.width, size.height);
      } else if (w > 0) {
        const s = freshSize();
        makeCanvas(s.width, s.height);
        clearTo(medium.paper);
      }
    },
    setBlind(next) {
      if (blind === next) return;
      blind = next;
      window.clearTimeout(peekTimer);
      showOrHide();
    },
    peek(ms) {
      if (!canvas) return;
      canvas.style.visibility = "visible";
      window.clearTimeout(peekTimer);
      peekTimer = window.setTimeout(showOrHide, ms);
    },
    redraw() {
      if (sheet && canvas) replaySheet(sheet, size.width, size.height);
    },
  };
}
