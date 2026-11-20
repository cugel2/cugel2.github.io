/**
 * Poses from Muybridge's Animal Locomotion, via Northwestern University Libraries'
 * "Muybridge in Motion" (public/data/muybridge.json, built by scripts/build-muybridge.mjs).
 *
 * A plate is one action photographed by two to six cameras at once, about twelve
 * frames per camera row. Neighbouring frames are nearly the same pose, so a day
 * never takes two frames from one plate. Plates are dealt from a shuffled deck
 * kept across days: every plate in the pool is used once before any comes back,
 * and a returning plate gives a frame not shown before.
 */

export interface Plate {
  n: number;
  title: string;
  animal: string;
  movement: string;
  provider: string;
  /** Index into MuybridgeData.services. */
  s: number;
  rows: number;
  /** Frames as [IIIF region, camera row, column]. */
  f: [string, number, number][];
  /** Mean time between frames, in ms. */
  ms: number;
  /** Why the plate is left out of the pose pool, if it is. */
  out?: string;
}

export interface MuybridgeData {
  source: string;
  services: string[];
  plates: Plate[];
}

export interface FrameRef {
  plate: number;
  frame: number;
}

export interface Deck {
  /** Plate numbers in dealing order. */
  order: number[];
  /** Index of the next plate in `order`. */
  next: number;
  /** Frames already shown, per plate number. */
  used: Record<string, number[]>;
}

export type Random = () => number;

/** Frames retired with Skip pose, per plate number. */
export type Skipped = Record<string, number[]>;

/** How many frames either side of a skipped one go with it: neighbours are nearly the same pose. */
export const SKIP_NEIGHBOURS = 2;

/**
 * Retires a skipped frame: the frame and its near neighbours in the same camera
 * row. A second skip in a row that already has one retires the whole row, since
 * then the camera's view is the trouble (a carriage seen from behind), not the moment.
 * Other cameras and other moments of the action stay in the deck.
 */
export function skipFrame(data: MuybridgeData, skipped: Skipped, ref: FrameRef): Skipped {
  const plate = plateOf(data, ref.plate);
  if (!plate) return skipped;
  const [, row, col] = plate.f[ref.frame];
  const already = new Set(skipped[ref.plate] ?? []);
  const rowHasSkip = plate.f.some(([, r], i) => r === row && already.has(i));
  plate.f.forEach(([, r, c], i) => {
    if (r === row && (rowHasSkip || Math.abs(c - col) <= SKIP_NEIGHBOURS)) already.add(i);
  });
  return { ...skipped, [ref.plate]: [...already].sort((a, b) => a - b) };
}

export function poolPlates(data: MuybridgeData): Plate[] {
  return data.plates.filter((p) => !p.out);
}

function shuffle<T>(items: T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function newDeck(data: MuybridgeData, random: Random = Math.random): Deck {
  return { order: shuffle(poolPlates(data).map((p) => p.n), random), next: 0, used: {} };
}

/**
 * Deals `count` frames, each from a different plate. When the deck runs out it is
 * reshuffled, with the plates already dealt in this call moved to the back.
 */
export function dealPoses(data: MuybridgeData, deck: Deck, count: number, random: Random = Math.random, skipped: Skipped = {}): { poses: FrameRef[]; deck: Deck } {
  const plates = new Map(data.plates.map((p) => [p.n, p]));
  const allowed = (p: Plate) => p.f.map((_, i) => i).filter((i) => !(skipped[p.n] ?? []).includes(i));
  // A plate with every frame skipped leaves the pool.
  const pool = new Set(poolPlates(data).filter((p) => allowed(p).length > 0).map((p) => p.n));
  let order = deck.order.filter((n) => pool.has(n));
  let next = Math.min(deck.next, order.length);
  const used: Record<string, number[]> = Object.fromEntries(Object.entries(deck.used).map(([k, v]) => [k, [...v]]));
  const dealt = new Set<number>();
  const poses: FrameRef[] = [];
  // Plates added to the pool since the deck was shuffled join the back of it.
  const missing = [...pool].filter((n) => !order.includes(n));
  if (missing.length) order = [...order, ...shuffle(missing, random)];
  while (poses.length < count && pool.size > 0) {
    if (next >= order.length) {
      const fresh = shuffle([...pool], random);
      order = [...fresh.filter((n) => !dealt.has(n)), ...fresh.filter((n) => dealt.has(n))];
      next = 0;
    }
    const n = order[next++];
    // A pool smaller than the day's poses has to repeat plates.
    if (dealt.has(n) && dealt.size < pool.size) continue;
    const plate = plates.get(n)!;
    const shown = used[n] ?? [];
    const usable = allowed(plate);
    let fresh = usable.filter((i) => !shown.includes(i));
    if (fresh.length === 0) { fresh = usable; used[n] = []; }
    const frame = fresh[Math.floor(random() * fresh.length)];
    used[n] = [...(used[n] ?? []), frame];
    dealt.add(n);
    poses.push({ plate: n, frame });
  }
  return { poses, deck: { order, next, used } };
}

export function plateOf(data: MuybridgeData, n: number): Plate | undefined {
  return data.plates.find((p) => p.n === n);
}

/** The frame's image at its full size. */
export function frameUrl(data: MuybridgeData, ref: FrameRef): string {
  const plate = plateOf(data, ref.plate);
  if (!plate) throw new Error(`No plate ${ref.plate}`);
  return `${data.services[plate.s]}/${plate.f[ref.frame][0]}/full/0/default.jpg`;
}

/** "Plate 26 · Walking, carrying a 75-lb. stone on left shoulder". */
export function frameCaption(data: MuybridgeData, ref: FrameRef): string {
  const plate = plateOf(data, ref.plate);
  return plate ? `Plate ${plate.n} · ${plate.title}` : `Plate ${ref.plate}`;
}

/**
 * A later moment of the same action from the same camera: `ahead` frames on in the
 * frame's row, or the row's last frame. Null when the frame is already the last.
 */
export function laterFrame(data: MuybridgeData, ref: FrameRef, ahead = 4): FrameRef | null {
  const plate = plateOf(data, ref.plate);
  if (!plate) return null;
  const [, row, col] = plate.f[ref.frame];
  const inRow = plate.f.map(([, r, c], i) => ({ r, c, i })).filter((f) => f.r === row).sort((a, b) => a.c - b.c);
  const later = inRow.filter((f) => f.c > col);
  if (later.length === 0) return null;
  return { plate: ref.plate, frame: later[Math.min(ahead, later.length) - 1].i };
}
