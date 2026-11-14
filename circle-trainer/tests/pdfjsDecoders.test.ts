import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Safari 26.6 refuses WebAssembly that uses relaxed SIMD, and PDF.js then
 * silently falls back to a JavaScript JPEG 2000 decoder about ten times
 * slower. pdfjs-dist 5.7–6.4 shipped such an openjpeg.wasm; 6.5.438 does not.
 * Relaxed SIMD opcodes are 0xFD followed by the LEB128 opcode 0x100–0x113,
 * i.e. the bytes FD [80–93] 02. This byte check agreed with the iPad for
 * every version tried; recheck on the iPad (PDF test page) after upgrading.
 */
function relaxedSimdHits(bytes: Uint8Array): number {
  let hits = 0;
  for (let i = 0; i + 2 < bytes.length; i += 1) {
    if (bytes[i] === 0xfd && bytes[i + 1] >= 0x80 && bytes[i + 1] <= 0x93 && bytes[i + 2] === 0x02) hits += 1;
  }
  return hits;
}

describe("PDF.js image decoders", () => {
  for (const name of ["openjpeg.wasm", "jbig2.wasm"]) {
    it(`${name} avoids relaxed SIMD, which iPad Safari cannot run`, () => {
      const bytes = new Uint8Array(readFileSync(`node_modules/pdfjs-dist/wasm/${name}`));
      expect(relaxedSimdHits(bytes)).toBe(0);
    });
  }
});
