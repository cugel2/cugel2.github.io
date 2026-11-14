/**
 * Document space for Copy mode. Pages are stacked vertically at a common
 * width of 1 document unit, with a small gap between them. A view is the
 * part of the document inside the frame: its top-left corner (x, y) and the
 * document width it spans (w). Keeping the view in document units, not
 * pixels, lets it survive a resize or rotation unchanged.
 */

export interface PageSize { width: number; height: number }

export interface DocLayout {
  /** Top of each page, in document units. */
  tops: number[];
  /** Height of each page, in document units (width is always 1). */
  heights: number[];
  /** Total height including gaps. */
  height: number;
}

export interface View { x: number; y: number; w: number }

export interface FrameSize { width: number; height: number }

export interface Point { x: number; y: number }

/** Gap between stacked pages, as a fraction of page width. */
export const PAGE_GAP = 0.03;
/** Most zoomed in: the frame spans 2% of a page's width. */
export const MIN_VIEW_WIDTH = 0.02;

export function layoutPages(sizes: readonly PageSize[], gap = PAGE_GAP): DocLayout {
  const tops: number[] = [];
  const heights: number[] = [];
  let y = 0;
  sizes.forEach((size, index) => {
    if (index > 0) y += gap;
    tops.push(y);
    const height = size.width > 0 ? size.height / size.width : 1;
    heights.push(height);
    y += height;
  });
  return { tops, heights, height: y };
}

export function viewHeight(view: View, frame: FrameSize): number {
  return view.w * (frame.height / frame.width);
}

/** Frame pixels per document unit. */
export function viewScale(view: View, frame: FrameSize): number {
  return frame.width / view.w;
}

export function frameToDoc(view: View, frame: FrameSize, point: Point): Point {
  const scale = viewScale(view, frame);
  return { x: view.x + point.x / scale, y: view.y + point.y / scale };
}

export function docToFrame(view: View, frame: FrameSize, point: Point): Point {
  const scale = viewScale(view, frame);
  return { x: (point.x - view.x) * scale, y: (point.y - view.y) * scale };
}

/** Largest view width allowed: the whole document fits twice over. */
export function maxViewWidth(layout: DocLayout, frame: FrameSize): number {
  const aspect = frame.width / frame.height;
  return 2 * Math.max(1, layout.height * aspect);
}

/** Keeps the zoom within limits and the frame's centre on the document. */
export function clampView(view: View, layout: DocLayout, frame: FrameSize): View {
  const w = Math.min(maxViewWidth(layout, frame), Math.max(MIN_VIEW_WIDTH, view.w));
  const h = w * (frame.height / frame.width);
  const centreX = Math.min(1, Math.max(0, view.x + view.w / 2));
  const centreY = Math.min(layout.height, Math.max(0, view.y + viewHeight(view, frame) / 2));
  return { x: centreX - w / 2, y: centreY - h / 2, w };
}

/**
 * A pan and zoom in one step: the document point under `from` (frame px)
 * ends up under `to`, and the zoom grows by `ratio` (2 = twice as large).
 */
export function moveView(view: View, layout: DocLayout, frame: FrameSize, from: Point, to: Point, ratio = 1): View {
  const anchor = frameToDoc(view, frame, from);
  const w = Math.min(maxViewWidth(layout, frame), Math.max(MIN_VIEW_WIDTH, view.w / ratio));
  const scale = frame.width / w;
  return clampView({ x: anchor.x - to.x / scale, y: anchor.y - to.y / scale, w }, layout, frame);
}

/** Zoom by `ratio` keeping the document point under `at` (frame px) fixed. */
export function zoomAbout(view: View, layout: DocLayout, frame: FrameSize, at: Point, ratio: number): View {
  return moveView(view, layout, frame, at, at, ratio);
}

/** The whole of page `index`, centred in the frame. */
export function fitPage(layout: DocLayout, frame: FrameSize, index = 0): View {
  const aspect = frame.width / frame.height;
  const pageHeight = layout.heights[index] ?? 1;
  const top = layout.tops[index] ?? 0;
  const w = Math.max(1, pageHeight * aspect);
  return { x: (1 - w) / 2, y: top + (pageHeight - w / aspect) / 2, w };
}

/** Pages intersecting the view, widened by `margin` (fraction of the view). */
export function visiblePages(layout: DocLayout, view: View, frame: FrameSize, margin = 0): number[] {
  const h = viewHeight(view, frame);
  const top = view.y - h * margin;
  const bottom = view.y + h * (1 + margin);
  const pages: number[] = [];
  layout.tops.forEach((pageTop, index) => {
    if (pageTop < bottom && pageTop + layout.heights[index] > top) pages.push(index);
  });
  return pages;
}

export function sameView(a: View | null, b: View | null, tolerance = 1e-6): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.x - b.x) < tolerance && Math.abs(a.y - b.y) < tolerance && Math.abs(a.w - b.w) < tolerance;
}
