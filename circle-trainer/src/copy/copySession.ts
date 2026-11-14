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

/** Draw from memory: how long you may study the reference (0 = off). */
export const MEMORY_SECONDS = [0, 15, 30, 60, 120] as const;
/** How long a Peek shows the reference again. */
export const PEEK_MS = 3000;

/**
 * OFF: memory off. READY: on, waiting for Start. STUDY: counting down, the
 * reference visible. HIDDEN: covered, draw from memory. PEEK: briefly shown.
 */
export type MemoryPhase = "OFF" | "READY" | "STUDY" | "HIDDEN" | "PEEK";

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
  /** Frame width / height, set when the copy starts and kept through rotations. */
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
  /** Draw from memory: study time in seconds, 0 for off. Kept across new copies. */
  memorySeconds: number;
  /** When Start was tapped; null before. */
  memoryStartedAt: number | null;
  /** While a Peek shows the reference, when it hides again. */
  peekUntil: number | null;
  peeks: number;
  updatedAt: number;
}

export function newSession(bookId: string | null, frameAspect: number, view: View | null, now = Date.now()): CopySession {
  return {
    version: 1, bookId, frameAspect, view, lockedView: null, strokes: [], compare: null, bothOpacity: 0.5, tint: true,
    memorySeconds: 0, memoryStartedAt: null, peekUntil: null, peeks: 0, updatedAt: now,
  };
}

/** A fresh copy of the same reference: strokes and framing go; the view, compare and memory settings stay. */
export function newCopy(session: CopySession, frameAspect: number, now = Date.now()): CopySession {
  return {
    ...newSession(session.bookId, frameAspect, session.view, now),
    bothOpacity: session.bothOpacity,
    tint: session.tint,
    memorySeconds: session.memorySeconds,
  };
}

// ----- draw from memory -----

export function memoryPhase(session: CopySession, now = Date.now()): MemoryPhase {
  if (session.memorySeconds <= 0) return "OFF";
  if (session.memoryStartedAt === null) return "READY";
  if (now < session.memoryStartedAt + session.memorySeconds * 1000) return "STUDY";
  if (session.peekUntil !== null && now < session.peekUntil) return "PEEK";
  return "HIDDEN";
}

/** Time left to study, in ms (0 once hidden). */
export function studyRemainingMs(session: CopySession, now = Date.now()): number {
  if (session.memoryStartedAt === null) return session.memorySeconds * 1000;
  return Math.max(0, session.memoryStartedAt + session.memorySeconds * 1000 - now);
}

/** Changing the setting starts the memory exercise over (the framing stays if there are strokes). */
export function setMemorySeconds(session: CopySession, seconds: number): CopySession {
  const valid = (MEMORY_SECONDS as readonly number[]).includes(seconds) ? seconds : 0;
  return { ...session, memorySeconds: valid, memoryStartedAt: null, peekUntil: null, peeks: 0 };
}

/** Start: the framing locks now, and the study countdown begins. */
export function startMemory(session: CopySession, now = Date.now()): CopySession {
  if (session.memorySeconds <= 0 || !session.view || session.memoryStartedAt !== null) return session;
  return { ...session, lockedView: session.lockedView ?? { ...session.view }, memoryStartedAt: now, peekUntil: null, peeks: 0, compare: null };
}

export function peek(session: CopySession, now = Date.now()): CopySession {
  if (memoryPhase(session, now) !== "HIDDEN") return session;
  return { ...session, peeks: session.peeks + 1, peekUntil: now + PEEK_MS };
}

/** The reference is covered while drawing from memory (Compare still reveals it). */
export function referenceCovered(session: CopySession, now = Date.now()): boolean {
  return memoryPhase(session, now) === "HIDDEN" && session.compare === null;
}

/** Once Start is tapped the reference stays where it was studied. */
export function referenceMovable(session: CopySession): boolean {
  return session.memorySeconds <= 0 || session.memoryStartedAt === null || session.compare !== null;
}

/**
 * Drawing is allowed only while not comparing (never with the reference
 * showing in the drawing frame), and, from memory, only once the reference
 * has been hidden: drawing while studying it would be copying.
 */
export function canDraw(session: CopySession, now = Date.now()): boolean {
  if (session.compare !== null || session.view === null) return false;
  const phase = memoryPhase(session, now);
  return phase !== "READY" && phase !== "STUDY";
}

/** Called at pen-down. The first stroke locks the framing. */
export function startStroke(session: CopySession, now = Date.now()): CopySession | null {
  if (!canDraw(session, now)) return null;
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
  return session.strokes.length > 0 ? session : { ...session, lockedView: null, compare: null, memoryStartedAt: null, peekUntil: null, peeks: 0 };
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
    memorySeconds: (MEMORY_SECONDS as readonly number[]).includes(raw.memorySeconds as number) ? raw.memorySeconds! : 0,
    memoryStartedAt: Number.isFinite(raw.memoryStartedAt) ? raw.memoryStartedAt! : null,
    peekUntil: null,
    peeks: Number.isFinite(raw.peeks) ? Math.max(0, Math.floor(raw.peeks!)) : 0,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt! : 0,
  };
}
