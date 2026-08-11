import { describe, expect, it } from "vitest";
import { deduplicateRawSamples } from "../src/core/input";
import type { RawSample } from "../src/core/types";

function sample(xCss: number, tMs: number): RawSample {
  return { xCss, yCss: 10, tMs, sourceEventType: "pointermove" };
}

describe("coalesced sample deduplication", () => {
  it("removes repeated samples across overlapping Safari event windows", () => {
    const samples = [
      sample(1, 10), sample(2, 14), sample(3, 18),
      sample(2, 14), sample(3, 18), sample(4, 22),
    ];
    expect(deduplicateRawSamples(samples).map((value) => value.tMs)).toEqual([10, 14, 18, 22]);
  });

  it("keeps different coordinates that share a timestamp", () => {
    expect(deduplicateRawSamples([sample(1, 10), sample(2, 10)])).toHaveLength(2);
  });
});
