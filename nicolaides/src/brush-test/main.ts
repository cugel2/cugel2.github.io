/**
 * Brush test: p5.brush's preset media driven by the Pencil, to judge which
 * library the course's pencil, crayon, ink, Conté, watercolour and oil blocks
 * should use. Strokes are drawn in short overlapping spline pieces as the Pencil
 * moves. "Wash" draws a watercolour fill inside the shape you outline.
 */
// @ts-expect-error p5.brush ships without type declarations.
import * as brush from "p5.brush/standalone";

import { BRUSH_SCALE, BRUSHES, type BrushSpec, brushPressure as pressureFor } from "../core/brushes";

function brushPressure(spec: BrushSpec, pencilPressure: number): number {
  return pressureFor(spec.kind, pencilPressure);
}

const stage = document.getElementById("stage")!;
const paper = document.getElementById("paper") as HTMLSelectElement;
const colour = document.getElementById("colour") as HTMLSelectElement;
let current = BRUSHES[0];

const box = stage.getBoundingClientRect();
const canvas: HTMLCanvasElement = brush.createCanvas(box.width, box.height, { pixelDensity: Math.min(2, window.devicePixelRatio || 1), parent: stage });
brush.scaleBrushes(BRUSH_SCALE);
brush.clear(paper.value);
brush.render();

const picker = document.getElementById("brushes")!;
for (const entry of BRUSHES) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = entry.label;
  b.setAttribute("aria-pressed", String(entry === current));
  b.addEventListener("click", () => {
    current = entry;
    for (const other of picker.children) other.setAttribute("aria-pressed", String(other === b));
  });
  picker.append(b);
}

document.getElementById("clear")!.addEventListener("click", () => { brush.clear(paper.value); brush.render(); });
paper.addEventListener("change", () => { brush.clear(paper.value); brush.render(); });

type P = [number, number, number];
let points: P[] = [];
let drawnTo = 0;
let pointerId: number | null = null;

function local(e: PointerEvent): P {
  const r = canvas.getBoundingClientRect();
  // A mouse draws as a light-to-medium Pencil touch.
  const pressure = brushPressure(current, e.pointerType === "pen" ? e.pressure : 0.25);
  // The canvas may be shown stretched (a rotation or a wrapped header after load), so map
  // from where it is on screen to its own drawing size. p5.brush puts the origin at the centre.
  const w = parseFloat(canvas.style.width);
  const h = parseFloat(canvas.style.height);
  return [((e.clientX - r.left) / r.width - 0.5) * w, ((e.clientY - r.top) / r.height - 0.5) * h, pressure];
}

function flush(final: boolean): void {
  if (current.kind === "wash") return;
  const from = Math.max(0, drawnTo - 1);
  if (points.length - from < (final ? 2 : 4)) return;
  brush.set(current.name, colour.value, current.weight);
  brush.noFill();
  brush.spline(points.slice(from), 0.5);
  brush.render();
  drawnTo = points.length;
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch" || pointerId !== null) return;
  e.preventDefault();
  pointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  points = [local(e)];
  drawnTo = 0;
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== pointerId) return;
  e.preventDefault();
  const list = e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e];
  for (const c of list) {
    const p = local(c);
    const last = points[points.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 2) points.push(p);
  }
  flush(false);
});
const end = (e: PointerEvent) => {
  if (e.pointerId !== pointerId) return;
  pointerId = null;
  if (current.kind === "wash" && points.length > 3) {
    brush.noStroke();
    brush.noHatch();
    brush.fill(colour.value, 70);
    brush.fillBleed(0.25);
    brush.polygon(points.map(([x, y]) => [x, y]));
    brush.render();
    brush.noFill();
  } else {
    flush(true);
  }
  points = [];
};
canvas.addEventListener("pointerup", end);
canvas.addEventListener("pointercancel", end);
canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });

/**
 * For tuning (from the console): draws a straight stroke with each brush at a
 * light touch and reports its measured width in mm, then clears.
 */
(window as unknown as { measureBrushes: (weights?: Record<string, number>) => Record<string, number> }).measureBrushes = (weights = {}) => {
  const out: Record<string, number> = {};
  // The canvas's own size, so this works while the page is in the background too.
  const r = { width: parseFloat(canvas.style.width) };
  const probe = document.createElement("canvas");
  probe.width = canvas.width;
  probe.height = canvas.height;
  const ctx = probe.getContext("2d", { willReadFrequently: true })!;
  const density = canvas.width / r.width;
  for (const spec of BRUSHES) {
    const { name, weight } = spec;
    if (spec.kind === "wash") continue;
    brush.clear("#ffffff");
    brush.set(name, "#000000", weights[name] ?? weight);
    brush.noFill();
    const line: P[] = [];
    for (let x = -r.width / 3; x <= r.width / 3; x += 4) line.push([x, 0, brushPressure(spec, 0.25)]);
    brush.spline(line, 0.5);
    brush.render();
    ctx.clearRect(0, 0, probe.width, probe.height);
    ctx.drawImage(canvas, 0, 0);
    // Darkness per row across the middle third of the stroke; width where it passes a quarter of the darkest row.
    const x0 = Math.round(probe.width * 0.4);
    const w = Math.round(probe.width * 0.2);
    const rows: number[] = [];
    const cy = Math.round(probe.height / 2);
    const span = Math.round(80 * density);
    const data = ctx.getImageData(x0, cy - span, w, span * 2).data;
    for (let y = 0; y < span * 2; y += 1) {
      let dark = 0;
      for (let x = 0; x < w; x += 1) dark += 255 - data[(y * w + x) * 4];
      rows.push(dark / w);
    }
    const peak = Math.max(...rows);
    const width = rows.filter((v) => v > peak * 0.25).length / density;
    out[name] = Math.round((width / 5.2) * 100) / 100;
  }
  brush.clear(paper.value);
  brush.render();
  return out;
};
