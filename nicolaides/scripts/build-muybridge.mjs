// Turns the manifests fetched by fetch-muybridge.mjs into src/public/data/muybridge.json:
// one entry per plate with its frames (image region, camera row, column, timing) and,
// for plates left out of the pose pool, the reason.
//   node scripts/build-muybridge.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const IN = resolve(import.meta.dirname, "../research/muybridge");
const OUT = resolve(import.meta.dirname, "../src/public/data/muybridge.json");

/** Plates 537–562 record illness and disability for medical study. */
const MEDICAL = [537, 562];
const CHILDREN = /\b(child|children|boy|boy's|infant|baby)\b/i;
/** Walking with nothing else going on: these look nearly alike. */
const PLAIN_WALKING = /^walking(( with (shoes|high-heeled boots) on)|(, (right|left|both) (hand|elbow|elbows) (at chin|across abdomen|bent)(, shoes on)?))?$/i;

export function exclusion(plate, animal, movement, title) {
  if (plate >= MEDICAL[0] && plate <= MEDICAL[1]) return "medical";
  if (CHILDREN.test(title)) return "children";
  if (animal === "Human" && movement === "Walking" && PLAIN_WALKING.test(title.trim())) return "plain walking";
  if (movement === "Standing") return "standing";
  if (movement === "Gesturing" && /^movement of the hand/i.test(title)) return "hand only";
  return null;
}

/** Splits "https://host/prefix/<id>/<region>/full/0/default.jpg" into service and region. */
function splitImageUrl(url) {
  const match = /^(.*)\/([^/]+)\/[^/]+\/0\/default\.jpg$/.exec(url);
  if (!match) throw new Error(`Unexpected image URL ${url}`);
  return { service: match[1], region: match[2] };
}

function parseRegion(region) {
  const percent = region.startsWith("pct:");
  const [x, y, w, h] = region.replace("pct:", "").split(",").map(Number);
  return { x, y, w, h, percent };
}

/** Groups frames into camera rows: a new row starts where y jumps by more than half a frame's height. */
function assignRows(regions) {
  const order = regions.map((r, i) => ({ ...r, i })).sort((a, b) => a.y - b.y);
  const heights = regions.map((r) => r.h).sort((a, b) => a - b);
  const gap = heights[Math.floor(heights.length / 2)] / 2;
  const rows = new Array(regions.length);
  let row = 0;
  let rowStart = order[0].y;
  for (const r of order) {
    if (r.y - rowStart > gap) { row += 1; rowStart = r.y; }
    rows[r.i] = row;
  }
  const cols = new Array(regions.length);
  for (let current = 0; current <= row; current += 1) {
    regions.map((r, i) => ({ x: r.x, i })).filter(({ i }) => rows[i] === current)
      .sort((a, b) => a.x - b.x).forEach(({ i }, col) => { cols[i] = col; });
  }
  return { rows, cols, rowCount: row + 1 };
}

const collection = JSON.parse(readFileSync(join(IN, "collection.json"), "utf8"));
const services = [];
const plates = [];
const excluded = {};
for (const item of collection.items) {
  const manifest = JSON.parse(readFileSync(join(IN, item.id.split("/").pop()), "utf8"));
  const meta = Object.fromEntries((manifest.metadata ?? []).map((m) => [Object.values(m.label)[0][0], Object.values(m.value)[0][0]]));
  const number = Number(meta["Plate Number"]);
  const title = Object.values(manifest.label)[0][0].replace(/^Plate Number \d+\.\s*/, "").trim();
  const annotations = manifest.items[0].items[0].items;
  const frames = annotations.map((a) => {
    const body = Array.isArray(a.body) ? a.body[0] : a.body;
    const { service, region } = splitImageUrl(body.id);
    const t = /#t=([\d.]+),([\d.]+)/.exec(a.target);
    return { service, region, ms: t ? Math.round((Number(t[2]) - Number(t[1])) * 1000) : 100 };
  });
  const service = frames[0].service;
  if (frames.some((f) => f.service !== service)) throw new Error(`Plate ${number} mixes image sources`);
  if (!services.includes(service)) services.push(service);
  const { rows, cols, rowCount } = assignRows(frames.map((f) => parseRegion(f.region)));
  const reason = exclusion(number, meta.Animal, meta.Movement, title);
  if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
  plates.push({
    n: number,
    title,
    animal: meta.Animal,
    movement: meta.Movement,
    provider: meta.Provider,
    s: services.indexOf(service),
    rows: rowCount,
    // [region, camera row, column]
    f: frames.map((f, i) => [f.region, rows[i], cols[i]]),
    ms: Math.round(frames.reduce((sum, f) => sum + f.ms, 0) / frames.length),
    ...(reason ? { out: reason } : {}),
  });
}

mkdirSync(resolve(OUT, ".."), { recursive: true });
const data = {
  source: "Muybridge in Motion, Northwestern University Libraries (https://nulib-ds.github.io/muybridge/); images courtesy of the National Gallery of Art, Smithsonian Institution and Boston Public Library",
  services,
  plates,
};
writeFileSync(OUT, JSON.stringify(data));
const pool = plates.filter((p) => !p.out);
console.log(`${plates.length} plates, ${pool.length} in the pose pool (${pool.reduce((s, p) => s + p.f.length, 0)} frames); left out:`, excluded);
