import { describe, expect, it } from "vitest";
import { COPY_WIDTH_RANGE, drawVariableWidthStroke, pressureWidthsMm, type StrokeContext } from "../src/core/strokeRender";

/** Records every call and property write, in order. */
function recorder(): { context: StrokeContext; log: string[] } {
  const log: string[] = [];
  const target: Record<string, unknown> = {};
  const context = new Proxy(target, {
    get: (_object, key) => (...args: unknown[]) => { log.push(`${String(key)}(${args.map((arg) => JSON.stringify(arg)).join(",")})`); },
    set: (_object, key, value) => { log.push(`${String(key)}=${JSON.stringify(value)}`); return true; },
  }) as unknown as StrokeContext;
  return { context, log };
}

describe("strokeRender", () => {
  it("draws exactly what the Taper renderer drew before it moved here", () => {
    const { context, log } = recorder();
    drawVariableWidthStroke(context, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }], [2, 4, 6]);
    expect(log).toEqual([
      "save()", 'strokeStyle="#171717"', 'fillStyle="#171717"', "setLineDash([])", 'lineCap="round"',
      "beginPath()", `arc(0,0,1,0,${Math.PI * 2})`, "fill()",
      "lineWidth=3", "beginPath()", "moveTo(0,0)", "lineTo(10,0)", "stroke()",
      "lineWidth=5", "beginPath()", "moveTo(10,0)", "lineTo(20,5)", "stroke()",
      "restore()",
    ]);
  });

  it("maps pressure to Copy mode's pencil range, borrowing widths at the ends", () => {
    const widths = pressureWidthsMm([0.08, 0.03, 0.5, 0.9, 0], COPY_WIDTH_RANGE, 0.8);
    expect(widths[1]).toBeCloseTo(0.4);
    expect(widths[2]).toBeCloseTo(1.6);
    expect(widths[3]).toBeCloseTo(1.6);
    expect(widths[0]).toBe(widths[1]);
    expect(widths[4]).toBe(widths[3]);
    expect(pressureWidthsMm([undefined], COPY_WIDTH_RANGE, 0.8)).toEqual([0.8]);
  });
});
