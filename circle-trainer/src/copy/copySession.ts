/**
 * The copy in progress: strokes, framing and compare state. Pure functions
 * returning new sessions, so the rules are testable without a screen.
 *
 * Strokes are stored in frame units (x and y as fractions of the frame's
 * width) and views in document units, so both survive a resize or rotation
 * with their registration intact.
 */
import { sameView, type View } from "./docSpace";

export type CompareView = "MINE" | "BOTH" | "REFERENCE";

export interface CopyPoint {
  x: number;
  y: number;
  /** Pencil pressure, 0–1, when reported. */
  p?: number;
}

export interface CopyStroke {
  points: CopyPoint[];
}

export interface CopySession {
  version: 1;
  bookId: string | null;
  /** Frame width / height; follows the screen until the first stroke, then fixed. */
  frameAspect: number;
  /** What the reference frame shows now. */
  view: View | null;
  /** The framing at the first stroke; Compare uses this. */
  lockedView: View | null;
  strokes: CopyStroke[];
  /** null while drawing. */
  compare: CompareView | null;
  /** Reference opacity in Both, 0.1–1. */
  bothOpacity: number;
  /** Tint the reference's dark lines blue in Both. */
  tint: boolean;
  updatedAt: number;
}

export function newSession(bookId: string | null, frameAspect: number, view: View | null, now = Date.now()): CopySession {
  return { version: 1, bookId, frameAspect, view, lockedView: null, strokes: [], compare: null, bothOpacity: 0.5, tint: true, updatedAt: now };
}

/** A fresh copy of the same reference: strokes and framing go, the view and compare settings stay. */
export function newCopy(session: CopySession, frameAspect: number, now = Date.now()): CopySession {
  return { ...newSession(session.bookId, frameAspect, session.view, now), bothOpacity: session.bothOpacity, tint: session.tint };
}

/** Drawing is allowed only while not comparing: never with the reference showing in the drawing frame. */
export function canDraw(session: CopySession): boolean {
  return session.compare === null && session.view !== null;
}

/** Called at pen-down. The first stroke locks the framing. */
export function startStroke(session: CopySession): CopySession | null {
  if (!canDraw(session)) return null;
  if (session.lockedView || !session.view) return session;
  return { ...session, lockedView: { ...session.view } };
}

export function addStroke(session: CopySession, stroke: CopyStroke, now = Date.now()): CopySession {
  if (stroke.points.length === 0) return session;
  return { ...session, strokes: [...session.strokes, stroke], updatedAt: now };
}

/**
 * With no strokes left nothing depends on the framing, so it is released:
 * the reference can be reframed and the next stroke locks the new framing.
 */
function releaseIfEmpty(session: CopySession): CopySession {
  return session.strokes.length > 0 ? session : { ...session, lockedView: null, compare: null };
}

export function undoStroke(session: CopySession, now = Date.now()): CopySession {
  if (session.strokes.length === 0) return session;
  return releaseIfEmpty({ ...session, strokes: session.strokes.slice(0, -1), updatedAt: now });
}

/** Removes every stroke and releases the framing. */
export function clearStrokes(session: CopySession, now = Date.now()): CopySession {
  return releaseIfEmpty({ ...session, strokes: [], updatedAt: now });
}

export function setView(session: CopySession, view: View): CopySession {
  return { ...session, view };
}

export function isOffFrame(session: CopySession): boolean {
  return session.lockedView !== null && !sameView(session.view, session.lockedView);
}

export function backToFrame(session: CopySession): CopySession {
  return session.lockedView ? { ...session, view: { ...session.lockedView } } : session;
}

/** Compare needs a locked framing, i.e. at least one stroke. */
export function canCompare(session: CopySession): boolean {
  return session.lockedView !== null;
}

export function setCompare(session: CopySession, compare: CompareView | null): CopySession {
  if (compare !== null && !canCompare(session)) return session;
  return { ...session, compare };
}

/** Tapping the frame while comparing flips between your drawing and the reference. */
export function blink(session: CopySession): CopySession {
  if (session.compare === "MINE") return { ...session, compare: "REFERENCE" };
  if (session.compare === "REFERENCE") return { ...session, compare: "MINE" };
  return session;
}

export function toFrameUnits(xPx: number, yPx: number, frameWidthPx: number, pressure?: number): CopyPoint {
  const point: CopyPoint = { x: xPx / frameWidthPx, y: yPx / frameWidthPx };
  if (pressure !== undefined) point.p = pressure;
  return point;
}

export function fromFrameUnits(point: CopyPoint, frameWidthPx: number): { x: number; y: number } {
  return { x: point.x * frameWidthPx, y: point.y * frameWidthPx };
}

function isView(value: unknown): value is View {
  const view = value as View;
  return typeof view === "object" && view !== null && [view.x, view.y, view.w].every(Number.isFinite) && view.w > 0;
}

/** Validates a stored session; anything malformed gives null rather than a broken copy. */
export function parseSession(value: unknown): CopySession | null {
  const raw = value as Partial<CopySession> | null;
  if (!raw || raw.version !== 1 || !Number.isFinite(raw.frameAspect) || (raw.frameAspect ?? 0) <= 0) return null;
  if (!Array.isArray(raw.strokes)) return null;
  const strokes: CopyStroke[] = [];
  for (const stroke of raw.strokes) {
    if (!stroke || !Array.isArray(stroke.points)) return null;
    const points = stroke.points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
    if (points.length > 0) strokes.push({ points });
  }
  const compare = raw.compare === "MINE" || raw.compare === "BOTH" || raw.compare === "REFERENCE" ? raw.compare : null;
  const lockedView = isView(raw.lockedView) ? raw.lockedView : null;
  return {
    version: 1,
    bookId: typeof raw.bookId === "string" ? raw.bookId : null,
    frameAspect: raw.frameAspect!,
    view: isView(raw.view) ? raw.view : null,
    lockedView,
    strokes,
    compare: lockedView ? compare : null,
    bothOpacity: Number.isFinite(raw.bothOpacity) ? Math.min(1, Math.max(0.1, raw.bothOpacity!)) : 0.5,
    tint: raw.tint !== false,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt! : 0,
  };
}
