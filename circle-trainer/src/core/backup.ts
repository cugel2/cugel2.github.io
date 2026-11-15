/**
 * Backup reminder on the Done card: practice data lives only in this browser, so after a
 * while without an export the card says so, with a button to export. Never a blocking prompt.
 */
import { dayKey } from "./timer";

/** Show the reminder once the last export is more than this many practice days old. */
export const BACKUP_REMINDER_AFTER_DAYS = 7;
/** With no export yet, wait for this many days of practice before reminding. */
export const BACKUP_REMINDER_MIN_PRACTICE_DAYS = 3;

/** Whole practice days (4 am day keys) from `earlierMs` to `laterMs`, never negative. */
export function practiceDaysBetween(earlierMs: number, laterMs: number): number {
  const toUtc = (key: string) => {
    const [year, month, date] = key.split("-").map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return Math.max(0, Math.round((toUtc(dayKey(laterMs)) - toUtc(dayKey(earlierMs))) / 86_400_000));
}

/**
 * The reminder text, or null when none is due. `lastExportMs` is null when nothing was ever
 * exported; `practiceDays` counts the days with any practice time.
 */
export function backupReminder(lastExportMs: number | null, practiceDays: number, nowMs: number): string | null {
  if (lastExportMs === null || !Number.isFinite(lastExportMs)) {
    return practiceDays >= BACKUP_REMINDER_MIN_PRACTICE_DAYS ? "Practice data not exported yet" : null;
  }
  const days = practiceDaysBetween(lastExportMs, nowMs);
  return days > BACKUP_REMINDER_AFTER_DAYS ? `Last export ${days} days ago` : null;
}

/** Stored value back to a timestamp, or null. */
export function parseLastExport(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
