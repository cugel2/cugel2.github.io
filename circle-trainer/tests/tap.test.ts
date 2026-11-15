import { describe, expect, it } from "vitest";
import { isTap, TAP_MAX_DURATION_MS, TAP_MAX_MOVEMENT_MM } from "../src/core/tap";

const PX_PER_MM = 5;
const at = (xCss: number, yCss: number, tMs: number) => ({ xCss, yCss, tMs });

describe("isTap", () => {
  it("accepts a short touch that does not move", () => {
    expect(isTap([at(100, 100, 0), at(100, 100, 80)], PX_PER_MM)).toBe(true);
  });

  it("accepts a single sample (down and up in one event)", () => {
    expect(isTap([at(10, 10, 0)], PX_PER_MM)).toBe(true);
  });

  it("accepts a touch exactly at the limits", () => {
    const edge = TAP_MAX_MOVEMENT_MM * PX_PER_MM;
    expect(isTap([at(0, 0, 0), at(edge, 0, 100), at(0, 0, TAP_MAX_DURATION_MS)], PX_PER_MM)).toBe(true);
  });

  it("rejects a touch held too long", () => {
    expect(isTap([at(0, 0, 0), at(0, 0, TAP_MAX_DURATION_MS + 1)], PX_PER_MM)).toBe(false);
  });

  it("rejects a touch that moves too far, even if it comes back", () => {
    const far = TAP_MAX_MOVEMENT_MM * PX_PER_MM + 1;
    expect(isTap([at(0, 0, 0), at(far, 0, 50), at(0, 0, 100)], PX_PER_MM)).toBe(false);
  });

  it("rejects a quick flick", () => {
    expect(isTap([at(0, 0, 0), at(30, 40, 60)], PX_PER_MM)).toBe(false);
  });

  it("measures movement in mm, so the same pixels pass at a denser scale", () => {
    const points = [at(0, 0, 0), at(15, 0, 100)];
    expect(isTap(points, 5)).toBe(false);
    expect(isTap(points, 10)).toBe(true);
  });

  it("rejects empty input and a bad scale", () => {
    expect(isTap([], PX_PER_MM)).toBe(false);
    expect(isTap([at(0, 0, 0)], 0)).toBe(false);
  });
});
