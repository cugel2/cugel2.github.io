import { randomBetween, seededRandom, type RandomSource } from "./random";
import { DEFAULT_HANDEDNESS, type BoxTarget, type Handedness, type Point2 } from "./types";

/**
 * Pure geometry for the Box "hinge swing" drill.
 *
 * A box with three edge lengths sits at the world origin in a random pose. One of its 12 edges is the
 * hinge; the answer is the same box rotated about that edge's line by the swing angle. Both boxes are
 * projected by one pinhole camera aimed at the reference box centre, so the hinge edge projects to the
 * same 2D segment in both. Each projection is then translated into its own half of the canvas.
 */

export type Vec3 = [number, number, number];
export type Quaternion = [number, number, number, number]; // w, x, y, z

export interface BoxViewport {
  width: number;
  height: number;
}

export interface BoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoxParameters {
  dimensionsMm: Vec3;
  referenceRotation: Quaternion;
  hingeEdgeIndex: number;
  swingDeg: number;
  cameraDistanceFactor: number;
}

/** Camera distance as a multiple of the box's bounding diameter (space diagonal). 4 gives parallel edges a median spread of about 8°. Provisional; tune on device. */
export const CAMERA_DISTANCE_FACTOR = 4;
export const SWING_MAGNITUDES_DEG: readonly number[] = [30, 45, 60];
export const LONGEST_EDGE_RANGE_MM = { minimum: 30, maximum: 55 } as const;
export const SHORTER_EDGE_RATIO_RANGE = { minimum: 0.4, maximum: 1 } as const;
/** Every projected edge of both boxes must be at least this long. */
export const MIN_PROJECTED_EDGE_MM = 10;
/** Reject hinges tilted more than this out of the picture plane: the swing would read as a flat turn. */
export const MAX_HINGE_OUT_OF_PLANE_DEG = 50;
/** Any two projected axis directions of either box must differ by at least this. */
export const MIN_AXIS_SEPARATION_DEG = 12;
/** The arrow shows the first part of the swing only, so it gives direction without revealing the answer. */
export const ARROW_SWEEP_DEG = 20;
/**
 * The arrow also starts this far *before* the current position, so it is a visibly curved arc
 * while its head still only shows ARROW_SWEEP_DEG of the swing. Its midpoint is "now".
 */
export const ARROW_BACK_SWEEP_DEG = 20;
/** Minimum on-screen length of that arrow for it to be readable. */
export const MIN_ARROW_LENGTH_MM = 12;
/**
 * The arrow runs on a circle this many times wider than the far edge's own path (same centre, same plane),
 * so it is longer and sits outside the box's lines instead of on top of them.
 */
export const ARROW_RADIUS_FACTOR = 1.4;
/** The angle label sits this far beyond the arrow tip. */
export const ARROW_LABEL_OFFSET_MM = 7;
/** Extra room kept around the label so the text does not clip the area edge. */
export const ARROW_LABEL_RADIUS_MM = 4;
export const BOX_EDGE_COUNT = 12;
export const BOX_STROKES_REQUIRED = 11;
const GENERATION_ATTEMPTS = 600;

/** Corner i has x/y/z sign from bits 0/1/2. */
export const BOX_EDGES: ReadonlyArray<readonly [number, number]> = (() => {
  const edges: Array<readonly [number, number]> = [];
  for (let axis = 0; axis < 3; axis += 1) {
    for (let corner = 0; corner < 8; corner += 1) {
      if ((corner & (1 << axis)) === 0) edges.push([corner, corner | (1 << axis)] as const);
    }
  }
  return edges;
})();

export function edgeAxis(edgeIndex: number): number {
  return Math.floor(edgeIndex / 4);
}

/** The parallel edge farthest from the given edge (diagonally opposite across the box). */
export function oppositeEdgeIndex(edgeIndex: number): number {
  const axis = edgeAxis(edgeIndex);
  const [start] = BOX_EDGES[edgeIndex];
  const otherBits = 7 & ~(1 << axis);
  const oppositeStart = start ^ otherBits;
  return BOX_EDGES.findIndex(([a]) => a === oppositeStart);
}

export function nonHingeEdgeIndices(hingeEdgeIndex: number): number[] {
  return Array.from({ length: BOX_EDGE_COUNT }, (_, index) => index).filter((index) => index !== hingeEdgeIndex);
}

/* ---------- vector helpers ---------- */

function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a: Vec3, s: number): Vec3 { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function length3(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a: Vec3): Vec3 { return scale(a, 1 / length3(a)); }

export function rotateByQuaternion(q: Quaternion, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  const u: Vec3 = [x, y, z];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, w)), cross(u, t));
}

/** Rodrigues rotation of v about the unit axis k by angle (right-handed). */
export function rotateAboutAxis(v: Vec3, k: Vec3, angleRad: number): Vec3 {
  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  return add(add(scale(v, cosine), scale(cross(k, v), sine)), scale(k, dot(k, v) * (1 - cosine)));
}

export function randomRotation(random: RandomSource): Quaternion {
  const u1 = random();
  const u2 = random();
  const u3 = random();
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return [b * Math.cos(2 * Math.PI * u3), a * Math.sin(2 * Math.PI * u2), a * Math.cos(2 * Math.PI * u2), b * Math.sin(2 * Math.PI * u3)];
}

/* ---------- 3D box ---------- */

export function boxDiameterMm(dimensionsMm: Vec3): number {
  return length3(dimensionsMm);
}

export function referenceCorners3d(dimensionsMm: Vec3, rotation: Quaternion): Vec3[] {
  return Array.from({ length: 8 }, (_, corner) => {
    const local: Vec3 = [
      ((corner & 1) ? 0.5 : -0.5) * dimensionsMm[0],
      ((corner & 2) ? 0.5 : -0.5) * dimensionsMm[1],
      ((corner & 4) ? 0.5 : -0.5) * dimensionsMm[2],
    ];
    return rotateByQuaternion(rotation, local);
  });
}

export function hingeAxis(corners: readonly Vec3[], hingeEdgeIndex: number): { origin: Vec3; direction: Vec3 } {
  const [a, b] = BOX_EDGES[hingeEdgeIndex];
  return { origin: corners[a], direction: normalize(sub(corners[b], corners[a])) };
}

export function swungCorners3d(corners: readonly Vec3[], hingeEdgeIndex: number, swingRad: number): Vec3[] {
  const { origin, direction } = hingeAxis(corners, hingeEdgeIndex);
  return corners.map((corner) => add(origin, rotateAboutAxis(sub(corner, origin), direction, swingRad)));
}

/* ---------- projection ---------- */

/**
 * The camera sits on the -z side at distance D from the reference box centre (the origin) and looks
 * along +z. Focal length equals D, so lengths at the box centre's depth project 1:1 in mm.
 * Screen x = world x, screen y = world y (canvas y points down).
 */
export function cameraDistanceMm(dimensionsMm: Vec3, factor: number): number {
  return boxDiameterMm(dimensionsMm) * factor;
}

export function projectPoint(point: Vec3, distanceMm: number): Point2 {
  const depth = distanceMm + point[2];
  return { x: (distanceMm * point[0]) / depth, y: (distanceMm * point[1]) / depth };
}

export interface ProjectedBoxPair {
  referenceMm: Point2[];
  answerMm: Point2[];
}

/** Both boxes in a common 2D frame (mm, camera centred), before translation to the canvas. */
export function projectBoxPair(parameters: BoxParameters, swingDegOverride?: number): ProjectedBoxPair {
  const distance = cameraDistanceMm(parameters.dimensionsMm, parameters.cameraDistanceFactor);
  const reference = referenceCorners3d(parameters.dimensionsMm, parameters.referenceRotation);
  const swingRad = ((swingDegOverride ?? parameters.swingDeg) * Math.PI) / 180;
  const answer = swungCorners3d(reference, parameters.hingeEdgeIndex, swingRad);
  return {
    referenceMm: reference.map((point) => projectPoint(point, distance)),
    answerMm: answer.map((point) => projectPoint(point, distance)),
  };
}

export function toCss(pointsMm: readonly Point2[], offsetCss: Point2, cssPxPerMm: number): Point2[] {
  return pointsMm.map((point) => ({ x: offsetCss.x + point.x * cssPxPerMm, y: offsetCss.y + point.y * cssPxPerMm }));
}

/** Answer corners in mm canvas coordinates for an arbitrary swing (used by the rotation readout). */
export function answerCornersMmForSwing(target: BoxTarget, swingDeg: number, cssPxPerMm: number): Point2[] {
  const { answerMm } = projectBoxPair(target, swingDeg);
  const offset = { x: target.answerOffsetCss.x / cssPxPerMm, y: target.answerOffsetCss.y / cssPxPerMm };
  return answerMm.map((point) => ({ x: offset.x + point.x, y: offset.y + point.y }));
}

/**
 * Arrow along the path of the midpoint of the edge opposite the hinge, pushed outward from the hinge by
 * ARROW_RADIUS_FACTOR, running from ARROW_BACK_SWEEP_DEG before the current position to ARROW_SWEEP_DEG into the swing.
 */
export function swingArrowMm(parameters: BoxParameters, steps = 24): Point2[] {
  const distance = cameraDistanceMm(parameters.dimensionsMm, parameters.cameraDistanceFactor);
  const reference = referenceCorners3d(parameters.dimensionsMm, parameters.referenceRotation);
  const [a, b] = BOX_EDGES[oppositeEdgeIndex(parameters.hingeEdgeIndex)];
  const midpoint = scale(add(reference[a], reference[b]), 0.5);
  const { origin, direction } = hingeAxis(reference, parameters.hingeEdgeIndex);
  const sign = Math.sign(parameters.swingDeg);
  const fromRad = (-sign * ARROW_BACK_SWEEP_DEG * Math.PI) / 180;
  const toRad = (sign * ARROW_SWEEP_DEG * Math.PI) / 180;
  const offset = sub(midpoint, origin);
  const along = scale(direction, dot(offset, direction));
  const start = add(along, scale(sub(offset, along), ARROW_RADIUS_FACTOR));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const rotated = add(origin, rotateAboutAxis(start, direction, fromRad + ((toRad - fromRad) * index) / steps));
    return projectPoint(rotated, distance);
  });
}

export function swingArrowCss(target: BoxTarget, cssPxPerMm: number): Point2[] {
  return toCss(swingArrowMm(target), target.referenceOffsetCss, cssPxPerMm);
}

/** Where the angle label goes: beyond the arrow tip, continuing its direction. */
export function arrowLabelMm(arrowMm: readonly Point2[]): Point2 {
  const tip = arrowMm.at(-1)!;
  const before = arrowMm.at(-3) ?? arrowMm[0];
  const dx = tip.x - before.x;
  const dy = tip.y - before.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: tip.x + (dx / length) * ARROW_LABEL_OFFSET_MM, y: tip.y + (dy / length) * ARROW_LABEL_OFFSET_MM };
}

export function arrowLabelCss(target: BoxTarget, cssPxPerMm: number): Point2 {
  const label = arrowLabelMm(swingArrowMm(target));
  return { x: target.referenceOffsetCss.x + label.x * cssPxPerMm, y: target.referenceOffsetCss.y + label.y * cssPxPerMm };
}

/* ---------- layout ---------- */

export function boxMarginCss(viewport: BoxViewport): number {
  return Math.min(72, Math.max(34, Math.min(viewport.width, viewport.height) * 0.08));
}

/**
 * In landscape the drawing (answer) area is on the drawing hand's side and the reference on the other, so the
 * hand and arm never cover the reference: left-handed puts the answer left. In portrait the reference is on top
 * for either hand. Each area is inset by the margin.
 */
export function boxAreas(
  viewport: BoxViewport,
  handedness: Handedness = DEFAULT_HANDEDNESS,
): { reference: BoxRect; answer: BoxRect; landscape: boolean } {
  const margin = boxMarginCss(viewport);
  const landscape = viewport.width >= viewport.height;
  if (landscape) {
    const half = viewport.width / 2;
    const left: BoxRect = { x: margin, y: margin, width: half - margin * 1.5, height: viewport.height - margin * 2 };
    const right: BoxRect = { x: half + margin / 2, y: margin, width: half - margin * 1.5, height: viewport.height - margin * 2 };
    return handedness === "LEFT" ? { landscape, reference: right, answer: left } : { landscape, reference: left, answer: right };
  }
  const half = viewport.height / 2;
  return {
    landscape,
    reference: { x: margin, y: margin, width: viewport.width - margin * 2, height: half - margin * 1.5 },
    answer: { x: margin, y: half + margin / 2, width: viewport.width - margin * 2, height: half - margin * 1.5 },
  };
}

function bounds(points: readonly Point2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function insideRect(points: readonly Point2[], rect: BoxRect): boolean {
  return points.every((point) => (
    point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
  ));
}

/** Points (mm, camera frame) the reference area must contain: the box, the arrow and room for its label. */
function referenceExtentMm(referenceMm: readonly Point2[], arrowMm: readonly Point2[]): Point2[] {
  const label = arrowLabelMm(arrowMm);
  const r = ARROW_LABEL_RADIUS_MM;
  return [...referenceMm, ...arrowMm, { x: label.x - r, y: label.y - r }, { x: label.x + r, y: label.y + r }];
}

/* ---------- filters ---------- */

function undirectedAngleDeg(a: Point2, b: Point2): number {
  const angle = Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y)) * 180 / Math.PI;
  return Math.min(angle, 180 - angle);
}

function axisDirections2d(cornersMm: readonly Point2[]): Point2[] {
  return [0, 1, 2].map((axis) => {
    let x = 0;
    let y = 0;
    for (let index = axis * 4; index < axis * 4 + 4; index += 1) {
      const [a, b] = BOX_EDGES[index];
      x += cornersMm[b].x - cornersMm[a].x;
      y += cornersMm[b].y - cornersMm[a].y;
    }
    return { x, y };
  });
}

export function minAxisSeparationDeg(cornersMm: readonly Point2[]): number {
  const [a, b, c] = axisDirections2d(cornersMm);
  return Math.min(undirectedAngleDeg(a, b), undirectedAngleDeg(a, c), undirectedAngleDeg(b, c));
}

export function minProjectedEdgeMm(cornersMm: readonly Point2[]): number {
  return Math.min(...BOX_EDGES.map(([a, b]) => Math.hypot(cornersMm[b].x - cornersMm[a].x, cornersMm[b].y - cornersMm[a].y)));
}

/** Angle between the hinge and the picture plane, measured against the line of sight to its midpoint. */
export function hingeOutOfPlaneDeg(parameters: BoxParameters): number {
  const distance = cameraDistanceMm(parameters.dimensionsMm, parameters.cameraDistanceFactor);
  const corners = referenceCorners3d(parameters.dimensionsMm, parameters.referenceRotation);
  const [a, b] = BOX_EDGES[parameters.hingeEdgeIndex];
  const direction = normalize(sub(corners[b], corners[a]));
  const midpoint = scale(add(corners[a], corners[b]), 0.5);
  const sight = normalize([midpoint[0], midpoint[1], midpoint[2] + distance]);
  return (Math.asin(Math.min(1, Math.abs(dot(direction, sight)))) * 180) / Math.PI;
}

export function arrowLengthMm(arrowMm: readonly Point2[]): number {
  let total = 0;
  for (let index = 1; index < arrowMm.length; index += 1) {
    total += Math.hypot(arrowMm[index].x - arrowMm[index - 1].x, arrowMm[index].y - arrowMm[index - 1].y);
  }
  return total;
}

/** Largest angle between the projections of parallel edges, averaged over the three axes (perspective strength). */
export function meanConvergenceDeg(cornersMm: readonly Point2[]): number {
  let total = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const directions = [0, 1, 2, 3].map((offset) => {
      const [a, b] = BOX_EDGES[axis * 4 + offset];
      return { x: cornersMm[b].x - cornersMm[a].x, y: cornersMm[b].y - cornersMm[a].y };
    });
    let largest = 0;
    for (let i = 0; i < 4; i += 1) for (let j = i + 1; j < 4; j += 1) largest = Math.max(largest, undirectedAngleDeg(directions[i], directions[j]));
    total += largest;
  }
  return total / 3;
}

/**
 * Returns null when the target passes every generation filter, otherwise a short reason.
 * Exported so tests (and later features such as chaining) can check any target.
 */
export function boxTargetRejection(
  target: BoxTarget,
  viewport: BoxViewport,
  cssPxPerMm: number,
  handedness: Handedness = DEFAULT_HANDEDNESS,
): string | null {
  const { referenceMm, answerMm } = projectBoxPair(target);
  if (Math.min(minProjectedEdgeMm(referenceMm), minProjectedEdgeMm(answerMm)) < MIN_PROJECTED_EDGE_MM) return "short-edge";
  if (hingeOutOfPlaneDeg(target) > MAX_HINGE_OUT_OF_PLANE_DEG) return "hinge-out-of-plane";
  if (Math.min(minAxisSeparationDeg(referenceMm), minAxisSeparationDeg(answerMm)) < MIN_AXIS_SEPARATION_DEG) return "axes-too-close";
  const arrowMm = swingArrowMm(target);
  if (arrowLengthMm(arrowMm) < MIN_ARROW_LENGTH_MM) return "arrow-too-short";
  const areas = boxAreas(viewport, handedness);
  if (!insideRect(toCss(referenceExtentMm(referenceMm, arrowMm), target.referenceOffsetCss, cssPxPerMm), areas.reference)) return "reference-does-not-fit";
  if (!insideRect(toCss(answerMm, target.answerOffsetCss, cssPxPerMm), areas.answer)) return "answer-does-not-fit";
  return null;
}

/* ---------- target construction ---------- */

/**
 * Builds a complete target. Both offsets put the hinge at the same place relative to its area, so the
 * position of the hinge in the drawing area does not hint at where the swung box ends up: the union of
 * the reference (with arrow) and the answer is centred in the area.
 */
export function buildBoxTarget(
  parameters: BoxParameters,
  viewport: BoxViewport,
  cssPxPerMm: number,
  handedness: Handedness = DEFAULT_HANDEDNESS,
): BoxTarget {
  const { referenceMm, answerMm } = projectBoxPair(parameters);
  const arrowMm = swingArrowMm(parameters);
  const union = bounds([...referenceExtentMm(referenceMm, arrowMm), ...answerMm]);
  const centreMm = { x: (union.minX + union.maxX) / 2, y: (union.minY + union.maxY) / 2 };
  const areas = boxAreas(viewport, handedness);
  const placement = (rect: BoxRect): Point2 => ({
    x: rect.x + rect.width / 2 - centreMm.x * cssPxPerMm,
    y: rect.y + rect.height / 2 - centreMm.y * cssPxPerMm,
  });
  const referenceOffsetCss = placement(areas.reference);
  const answerOffsetCss = placement(areas.answer);
  return {
    kind: "BOX",
    dimensionsMm: [...parameters.dimensionsMm],
    referenceRotation: [...parameters.referenceRotation],
    hingeEdgeIndex: parameters.hingeEdgeIndex,
    swingDeg: parameters.swingDeg,
    cameraDistanceFactor: parameters.cameraDistanceFactor,
    referenceOffsetCss,
    answerOffsetCss,
    referenceCornersCss: toCss(referenceMm, referenceOffsetCss, cssPxPerMm),
    answerCornersCss: toCss(answerMm, answerOffsetCss, cssPxPerMm),
  };
}

function candidateParameters(random: RandomSource): BoxParameters {
  const longest = randomBetween(random, LONGEST_EDGE_RANGE_MM.minimum, LONGEST_EDGE_RANGE_MM.maximum);
  const lengths: number[] = [
    longest,
    longest * randomBetween(random, SHORTER_EDGE_RATIO_RANGE.minimum, SHORTER_EDGE_RATIO_RANGE.maximum),
    longest * randomBetween(random, SHORTER_EDGE_RATIO_RANGE.minimum, SHORTER_EDGE_RATIO_RANGE.maximum),
  ];
  const longestAxis = Math.floor(random() * 3);
  [lengths[0], lengths[longestAxis]] = [lengths[longestAxis], lengths[0]];
  const referenceRotation = randomRotation(random);
  const hingeEdgeIndex = Math.floor(random() * BOX_EDGE_COUNT);
  const magnitude = SWING_MAGNITUDES_DEG[Math.floor(random() * SWING_MAGNITUDES_DEG.length)];
  const swingDeg = random() < 0.5 ? magnitude : -magnitude;
  return {
    dimensionsMm: [lengths[0], lengths[1], lengths[2]],
    referenceRotation,
    hingeEdgeIndex,
    swingDeg,
    cameraDistanceFactor: CAMERA_DISTANCE_FACTOR,
  };
}

/** A known-good pose used only if every seeded candidate is rejected (e.g. a tiny viewport). */
export const FALLBACK_BOX_PARAMETERS: BoxParameters = {
  dimensionsMm: [34, 26, 20],
  // Roughly 30° about x then 35° about y: a three-quarter view with a near-vertical hinge.
  referenceRotation: (() => {
    const qx: Quaternion = [Math.cos(Math.PI / 12), Math.sin(Math.PI / 12), 0, 0];
    const qy: Quaternion = [Math.cos((35 * Math.PI) / 360), 0, Math.sin((35 * Math.PI) / 360), 0];
    const [w1, x1, y1, z1] = qy;
    const [w2, x2, y2, z2] = qx;
    return [
      w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
      w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
      w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
      w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    ] as Quaternion;
  })(),
  hingeEdgeIndex: 4,
  swingDeg: 45,
  cameraDistanceFactor: CAMERA_DISTANCE_FACTOR,
};

export function generateBoxTarget(
  viewport: BoxViewport,
  cssPxPerMm: number,
  sessionSeed: string,
  sequenceIndex: number,
  handedness: Handedness = DEFAULT_HANDEDNESS,
): BoxTarget {
  const random = seededRandom(`${sessionSeed}:target:${sequenceIndex}:BOX`);
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = buildBoxTarget(candidateParameters(random), viewport, cssPxPerMm, handedness);
    if (boxTargetRejection(candidate, viewport, cssPxPerMm, handedness) === null) return candidate;
  }
  return buildBoxTarget(FALLBACK_BOX_PARAMETERS, viewport, cssPxPerMm, handedness);
}

/** Every edge of a corner set as css segments, in BOX_EDGES order. */
export function boxEdgeSegments(corners: readonly Point2[]): Array<[Point2, Point2]> {
  return BOX_EDGES.map(([a, b]) => [corners[a], corners[b]]);
}
