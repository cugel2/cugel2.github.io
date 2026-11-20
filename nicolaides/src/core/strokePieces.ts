/**
 * Cuts a stroke into the overlapping spline pieces p5.brush draws, the same way
 * live and on replay, with a seed per piece. Brush texture is random, so drawing
 * the same pieces with the same seeds is what makes Undo, the gallery and Save to
 * Photos show the sheet exactly as it was drawn.
 */
import { packStroke, type Sample, unpackStroke } from "./sheet";

/** Points closer than this (in sheet widths) to the last kept point are dropped. */
export const MIN_STEP = 0.003;
/** New points needed before a piece is drawn while the Pencil is moving. */
export const PIECE = 4;

/** Rounds a sample the way storage does, so live drawing and replay see identical numbers. */
export function quantize(sample: Sample): Sample {
  return { ...unpackStroke(packStroke([sample]))[0], t: sample.t };
}

/** A stable number from a string (FNV-1a). */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function strokeSeed(sheetId: string, strokeIndex: number): number {
  return (hashString(sheetId) + strokeIndex * 7919) % 2147483647;
}

export type DrawPiece = (points: readonly Sample[], seed: number) => void;

export class StrokePieces {
  private kept: Sample[] = [];
  private drawnTo = 0;
  private pieces = 0;

  constructor(private readonly seed: number, private readonly draw: DrawPiece) {}

  add(sample: Sample): void {
    const last = this.kept[this.kept.length - 1];
    if (last && Math.hypot(sample.x - last.x, sample.y - last.y) < MIN_STEP) return;
    this.kept.push(sample);
    const from = Math.max(0, this.drawnTo - 1);
    if (this.kept.length - from >= PIECE) this.emit(from);
  }

  /** Draws whatever is left; a single touch becomes a dot. */
  finish(): void {
    const from = Math.max(0, this.drawnTo - 1);
    if (this.kept.length === 1 && this.drawnTo === 0) {
      const p = this.kept[0];
      this.kept.push({ ...p, x: p.x + MIN_STEP / 3 });
    }
    if (this.kept.length - from >= 2) this.emit(from);
  }

  private emit(from: number): void {
    this.draw(this.kept.slice(from), this.seed + this.pieces);
    this.pieces += 1;
    this.drawnTo = this.kept.length;
  }
}

/** Replays a stored stroke through the same cutting. */
export function replayStroke(samples: readonly Sample[], seed: number, draw: DrawPiece): void {
  const pieces = new StrokePieces(seed, draw);
  for (const s of samples) pieces.add(s);
  pieces.finish();
}
