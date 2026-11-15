import { describe, expect, it } from "vitest";
import {
  BACKUP_REMINDER_AFTER_DAYS, BACKUP_REMINDER_MIN_PRACTICE_DAYS, backupReminder, parseLastExport, practiceDaysBetween,
} from "../src/core/backup";

/** Local time, so the 4 am rollover is tested as the app sees it. */
const at = (month: number, date: number, hour: number) => new Date(2026, month - 1, date, hour).getTime();

describe("practiceDaysBetween", () => {
  it("counts practice days, which roll over at 4 am", () => {
    expect(practiceDaysBetween(at(11, 1, 10), at(11, 1, 23))).toBe(0);
    expect(practiceDaysBetween(at(11, 1, 10), at(11, 2, 3))).toBe(0);
    expect(practiceDaysBetween(at(11, 1, 10), at(11, 2, 5))).toBe(1);
  });

  it("crosses months and a daylight-saving change", () => {
    expect(practiceDaysBetween(at(10, 20, 12), at(11, 10, 12))).toBe(21);
    expect(practiceDaysBetween(at(3, 1, 12), at(3, 31, 12))).toBe(30);
  });

  it("is never negative", () => {
    expect(practiceDaysBetween(at(11, 10, 12), at(11, 1, 12))).toBe(0);
  });
});

describe("backupReminder", () => {
  const now = at(11, 15, 12);

  it("stays quiet within a week of the last export", () => {
    expect(backupReminder(at(11, 15 - BACKUP_REMINDER_AFTER_DAYS, 12), 30, now)).toBeNull();
  });

  it("speaks up once the export is more than a week old", () => {
    expect(backupReminder(at(11, 7, 12), 30, now)).toBe("Last export 8 days ago");
    expect(backupReminder(at(11, 3, 12), 30, now)).toBe("Last export 12 days ago");
  });

  it("with no export, waits for a few days of practice", () => {
    expect(backupReminder(null, 0, now)).toBeNull();
    expect(backupReminder(null, BACKUP_REMINDER_MIN_PRACTICE_DAYS - 1, now)).toBeNull();
    expect(backupReminder(null, BACKUP_REMINDER_MIN_PRACTICE_DAYS, now)).toBe("Practice data not exported yet");
  });
});

describe("parseLastExport", () => {
  it("keeps a timestamp and drops anything else", () => {
    expect(parseLastExport(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(parseLastExport(undefined)).toBeNull();
    expect(parseLastExport("1700000000000")).toBeNull();
    expect(parseLastExport(Number.NaN)).toBeNull();
    expect(parseLastExport(0)).toBeNull();
  });
});
