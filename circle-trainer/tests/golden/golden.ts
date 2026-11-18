import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

/**
 * Golden values: outputs pinned in tests/golden/data/<name>.json and compared exactly (every digit of every number).
 *
 * Unlike vitest snapshots, a missing golden file fails the test instead of being quietly written, so a test that
 * has been moved or renamed cannot pass by recording new values. To (re)write the files on purpose — only ever
 * at stage 0 — run `UPDATE_GOLDEN=1 npx vitest run tests/golden`.
 */
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "data");

/** JSON with non-finite numbers kept apart (plain JSON turns NaN and ±Infinity all into null). */
function encode(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === "number" && !Number.isFinite(item) ? `__${item}__` : item), 1);
}

export function expectGolden(name: string, value: unknown): void {
  const file = join(DATA_DIR, `${name}.json`);
  const actual = encode(value);
  if (process.env.UPDATE_GOLDEN === "1") {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(file, `${actual}\n`);
    return;
  }
  if (!existsSync(file)) throw new Error(`Golden file missing: tests/golden/data/${name}.json`);
  expect(JSON.parse(actual)).toEqual(JSON.parse(readFileSync(file, "utf8")));
}
