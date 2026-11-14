import { describe, expect, it } from "vitest";
import { dayKey, formatClock, formatMinutes, IDLE_MS, nextRolloverMs, PracticeClock, SESSION_BREAK_MS } from "../src/core/timer";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
/** Local time, so the tests hold in any time zone. */
const at = (day: number, hour: number, minute = 0, second = 0) => new Date(2026, 10, day, hour, minute, second).getTime();

describe("practice day", () => {
  it("rolls over at 4 am local time", () => {
    expect(dayKey(at(13, 3, 59))).toBe("2026-11-12");
    expect(dayKey(at(13, 4, 0))).toBe("2026-11-13");
    expect(dayKey(at(13, 23, 59))).toBe("2026-11-13");
    expect(nextRolloverMs(at(13, 3, 0))).toBe(at(13, 4));
    expect(nextRolloverMs(at(13, 4, 0))).toBe(at(14, 4));
    expect(dayKey(at(1, 2))).toBe("2026-10-31");
  });
});

describe("practice clock", () => {
  it("counts steady drawing from timestamps", () => {
    const clock = new PracticeClock();
    const start = at(13, 9);
    for (let t = 0; t <= 5 * MINUTE; t += 10 * SECOND) clock.recordActivity(start + t);
    expect(clock.sessionTotalMs(start + 5 * MINUTE)).toBe(5 * MINUTE);
    expect(clock.todayTotalMs(start + 5 * MINUTE)).toBe(5 * MINUTE);
  });

  it("stops counting a minute after the last stroke", () => {
    const clock = new PracticeClock();
    const start = at(13, 9);
    clock.recordActivity(start);
    expect(clock.todayTotalMs(start + 30 * SECOND)).toBe(30 * SECOND);
    expect(clock.todayTotalMs(start + 10 * MINUTE)).toBe(IDLE_MS);
    // Drawing again after a 5-minute pause: the pause beyond the idle window is not counted.
    clock.recordActivity(start + 5 * MINUTE);
    clock.recordActivity(start + 5 * MINUTE + 20 * SECOND);
    expect(clock.todayTotalMs(start + 5 * MINUTE + 20 * SECOND)).toBe(IDLE_MS + 20 * SECOND);
  });

  it("does not count time while the page is hidden", () => {
    const clock = new PracticeClock();
    const start = at(13, 9);
    clock.recordActivity(start);
    clock.setVisible(false, start + 10 * SECOND);
    clock.setVisible(true, start + 50 * SECOND);
    clock.recordActivity(start + 55 * SECOND);
    expect(clock.todayTotalMs(start + 55 * SECOND)).toBe(15 * SECOND);
  });

  it("splits time across the 4 am rollover", () => {
    const clock = new PracticeClock();
    for (let t = at(14, 3, 58); t <= at(14, 4, 2); t += 10 * SECOND) clock.recordActivity(t);
    const totals = clock.snapshot(at(14, 4, 2));
    expect(totals["2026-11-13"]).toBe(2 * MINUTE);
    expect(totals["2026-11-14"]).toBe(2 * MINUTE);
    expect(clock.todayTotalMs(at(14, 4, 2))).toBe(2 * MINUTE);
  });

  it("starts a new session after a long break but keeps the day's total", () => {
    const clock = new PracticeClock();
    const start = at(13, 9);
    for (let t = 0; t <= 2 * MINUTE; t += 10 * SECOND) clock.recordActivity(start + t);
    const later = start + 2 * MINUTE + SESSION_BREAK_MS;
    expect(clock.sessionTotalMs(later)).toBe(0);
    clock.recordActivity(later);
    clock.recordActivity(later + 30 * SECOND);
    expect(clock.sessionTotalMs(later + 30 * SECOND)).toBe(30 * SECOND);
    expect(clock.todayTotalMs(later + 30 * SECOND)).toBe(2 * MINUTE + IDLE_MS + 30 * SECOND);
  });

  it("adds to totals restored from storage", () => {
    const clock = new PracticeClock({ "2026-11-13": 10 * MINUTE, "2026-11-12": 4 * MINUTE });
    clock.recordActivity(at(13, 20));
    clock.recordActivity(at(13, 20, 0, 40));
    expect(clock.todayTotalMs(at(13, 20, 0, 40))).toBe(10 * MINUTE + 40 * SECOND);
    expect(clock.snapshot(at(13, 20, 0, 40))["2026-11-12"]).toBe(4 * MINUTE);
  });
});

describe("time formatting", () => {
  it("shows the session as a clock and the day in minutes", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(247 * SECOND)).toBe("4:07");
    expect(formatClock(3727 * SECOND)).toBe("1:02:07");
    expect(formatMinutes(41 * MINUTE + 59 * SECOND)).toBe("41 min");
    expect(formatMinutes(65 * MINUTE)).toBe("1 h 05 min");
  });
});
