/**
 * Gallery (every sheet, by book day) and the sheet viewer with Save to Photos.
 * Save makes a PNG about 2,000 px on the long side from the stored strokes and
 * opens the share sheet, where "Save Image" puts it in Photos. Where sharing
 * files is not available (plain http, desktop) the picture is shown instead.
 */
import { COURSE, exerciseName } from "../core/course";
import { frameObjectUrl } from "../core/frames";
import { frameCaption, frameUrl, type MuybridgeData } from "../core/poses";
import type { Sheet } from "../core/sheet";
import { renderSheetImage } from "./brushRender";
import { allSheets, deleteSheet } from "../core/storage";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface GalleryHost {
  muybridge(): MuybridgeData | null;
  hand(): "left" | "right";
  toast(text: string): void;
  sheetDeleted(id: string): void;
}

/** "S10-1-C" → "Schedule 10 (repeat 1) · Day C". */
export function dayTitle(key: string): string {
  const m = /^S(\d+)-(\d+)-([A-E])$/.exec(key);
  if (!m) return key;
  return `Schedule ${m[1]}${m[2] !== "0" ? ` (repeat ${m[2]})` : ""} · Day ${m[3]}`;
}

/** Draws the sheet with its brushes into `canvas` (a 2D canvas) at `widthPx`. */
function renderSheet(canvas: HTMLCanvasElement, sheet: Sheet, widthPx: number): void {
  const image = renderSheetImage(sheet, widthPx);
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG failed"))), "image/png"));
}

function canShare(file: File): boolean {
  return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed"));
    img.src = src;
  });
}

const sheetName = (s: Sheet) => s.ex.map((id) => exerciseName(id, COURSE)).join(" + ");
const timeOf = (ms: number) => new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function mountGallery(host: GalleryHost) {
  const dialog = $<HTMLDialogElement>("galleryDialog");
  const days = $<HTMLOListElement>("galleryDays");
  const grid = $<HTMLDivElement>("galleryGrid");
  const back = $<HTMLButtonElement>("galleryBack");
  const title = $<HTMLHeadingElement>("galleryTitle");
  const viewer = $<HTMLDialogElement>("sheetDialog");
  const viewerCanvas = $<HTMLCanvasElement>("sheetCanvas");
  const saveDrawing = $<HTMLButtonElement>("saveDrawingButton");
  const saveSide = $<HTMLButtonElement>("saveSideBySideButton");
  const hint = $<HTMLParagraphElement>("saveHint");
  const fallback = $<HTMLImageElement>("saveFallback");
  let sheets: Sheet[] = [];
  let open: Sheet | null = null;
  let files: { drawing?: File; side?: File } = {};

  async function show(): Promise<void> {
    sheets = (await allSheets()).filter((s) => s.strokes.length > 0).sort((a, b) => b.created - a.created);
    showDays();
    if (!dialog.open) dialog.showModal();
  }

  function showDays(): void {
    title.textContent = "Gallery";
    back.hidden = true;
    grid.hidden = true;
    days.hidden = false;
    const byDay = new Map<string, Sheet[]>();
    for (const s of sheets) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);
    days.replaceChildren(...[...byDay].map(([day, list]) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<span></span><span class="muted"></span>`;
      (b.children[0] as HTMLElement).textContent = dayTitle(day);
      (b.children[1] as HTMLElement).textContent = `${list.length} sheet${list.length === 1 ? "" : "s"} · ${timeOf(list[list.length - 1].created)}`;
      b.addEventListener("click", () => showDay(day, list));
      li.append(b);
      return li;
    }));
    if (byDay.size === 0) days.innerHTML = `<li class="muted">No drawings yet.</li>`;
  }

  function showDay(day: string, list: Sheet[]): void {
    title.textContent = dayTitle(day);
    back.hidden = false;
    days.hidden = true;
    grid.hidden = false;
    const pending: [HTMLCanvasElement, Sheet][] = [];
    grid.replaceChildren(...[...list].reverse().map((sheet) => {
      const b = document.createElement("button");
      b.type = "button";
      const c = document.createElement("canvas");
      c.width = 360;
      c.height = Math.round(360 * sheet.aspect);
      pending.push([c, sheet]);
      const label = document.createElement("span");
      label.textContent = `${sheetName(sheet)} · ${timeOf(sheet.created)}`;
      b.append(c, label);
      b.addEventListener("click", () => void openSheet(sheet));
      return b;
    }));
    // Brush drawings take a moment each; draw them one at a time so the sheet stays responsive.
    const shown = grid;
    const next = () => {
      const item = pending.shift();
      if (!item || shown.hidden) return;
      renderSheet(item[0], item[1], 360);
      window.setTimeout(next, 0);
    };
    window.setTimeout(next, 0);
  }

  async function openSheet(sheet: Sheet): Promise<void> {
    open = sheet;
    files = {};
    $("sheetTitle").textContent = sheetName(sheet);
    const data = host.muybridge();
    $("sheetInfo").textContent = `${dayTitle(sheet.day)} · ${timeOf(sheet.created)} · ${sheet.strokes.length} strokes` +
      (data && sheet.poses.length ? ` · ${sheet.poses.length === 1 ? frameCaption(data, sheet.poses[0]) : `${sheet.poses.length} poses`}` : "");
    renderSheet(viewerCanvas, sheet, Math.min(1400, window.innerWidth * (window.devicePixelRatio || 1)));
    saveDrawing.disabled = true;
    saveSide.disabled = true;
    saveSide.hidden = !(data && sheet.poses.length === 1);
    fallback.hidden = true;
    hint.textContent = "Preparing…";
    if (!viewer.open) viewer.showModal();
    await prepareFiles(sheet);
  }

  /** Made when the viewer opens, so the tap can share at once (Safari needs the tap). */
  async function prepareFiles(sheet: Sheet): Promise<void> {
    const long = 2000;
    const width = sheet.aspect >= 1 ? long / sheet.aspect : long;
    const drawing = document.createElement("canvas");
    renderSheet(drawing, sheet, width);
    const stamp = new Date(sheet.created).toISOString().slice(0, 10);
    files.drawing = new File([await toPng(drawing)], `nicolaides-${sheet.day}-${stamp}.png`, { type: "image/png" });
    if (open !== sheet) return;
    saveDrawing.disabled = false;
    const data = host.muybridge();
    if (data && sheet.poses.length === 1) {
      try {
        const img = await loadImage(await frameObjectUrl(frameUrl(data, sheet.poses[0])));
        const h = drawing.height;
        const refW = Math.round((img.naturalWidth / img.naturalHeight) * h);
        const side = document.createElement("canvas");
        side.width = drawing.width + refW;
        side.height = h;
        const ctx = side.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, side.width, side.height);
        // The same sides as in the app: drawing on the drawing hand's side.
        const left = host.hand() === "left";
        ctx.drawImage(drawing, left ? 0 : refW, 0);
        ctx.drawImage(img, left ? drawing.width : 0, 0, refW, h);
        files.side = new File([await toPng(side)], `nicolaides-${sheet.day}-${stamp}-with-reference.png`, { type: "image/png" });
        if (open === sheet) saveSide.disabled = false;
      } catch {
        saveSide.hidden = true;
      }
    }
    if (open === sheet) hint.textContent = files.drawing && canShare(files.drawing)
      ? "Opens the share sheet. Choose “Save Image” to put it in Photos."
      : "Sharing needs the app over https; the picture appears below instead. Press and hold it to save.";
  }

  function share(file: File | undefined): void {
    if (!file) return;
    if (canShare(file)) {
      navigator.share({ files: [file] }).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) host.toast("The share sheet could not open");
      });
      return;
    }
    fallback.src = URL.createObjectURL(file);
    fallback.hidden = false;
  }

  saveDrawing.addEventListener("click", () => share(files.drawing));
  saveSide.addEventListener("click", () => share(files.side));
  back.addEventListener("click", showDays);
  $("deleteSheetButton").addEventListener("click", async () => {
    if (!open || !confirm("Delete this sheet? This cannot be undone.")) return;
    const id = open.id;
    await deleteSheet(id);
    host.sheetDeleted(id);
    viewer.close();
    open = null;
    if (dialog.open) await show();
  });

  return { show, openSheet };
}
