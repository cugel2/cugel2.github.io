/**
 * Practice-time tracking for logging by hand (e.g. in Toggl). Time is counted from timestamps, never from
 * timer ticks: it accrues only while the page is visible and a stroke happened within the last IDLE_MS.
 * The day rolls over at DAY_ROLLOVER_HOUR local time; the daily queue will use the same day key.
 */

/** Counting stops this long after the last stroke (reading feedback and thinking between strokes still count). */
export const IDLE_MS = 60_000;
/** A gap this long with no drawing starts a new session. */
export const SESSION_BREAK_MS = 15 * 60_000;
/** Practice after midnight but before this hour belongs to the previous day. */
export const DAY_ROLLOVER_HOUR = 4;

/** Practice milliseconds per day key. */
export type DailyTotals = Record<string, number>;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "YYYY-MM-DD" of the practice day containing this moment (local time, rolling over at 4 am). */
export function dayKey(epochMs: number): string {
  const date = new Date(epochMs);
  if (date.getHours() < DAY_ROLLOVER_HOUR) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The first rollover strictly after this moment. */
export function nextRolloverMs(epochMs: number): number {
  const date = new Date(epochMs);
  const rollover = new Date(date.getFullYear(), date.getMonth(), date.getDate(), DAY_ROLLOVER_HOUR);
  if (rollover.getTime() <= epochMs) rollover.setDate(rollover.getDate() + 1);
  return rollover.getTime();
}

export class PracticeClock {
  private readonly totals: DailyTotals;
  private visible: boolean;
  private lastActivityMs: number | null = null;
  /** Everything before this moment has already been counted (or deliberately skipped). */
  private countedUntilMs = 0;
  private sessionMs = 0;

  constructor(totals: DailyTotals = {}, visible = true) {
    this.totals = { ...totals };
    this.visible = visible;
  }

  /** Counts the time since the last call that falls inside the idle window, split across day rollovers. */
  private accrue(nowMs: number): void {
    if (!this.visible || this.lastActivityMs === null) return;
    const end = Math.min(nowMs, this.lastActivityMs + IDLE_MS);
    let from = this.countedUntilMs;
    if (end <= from) return;
    this.sessionMs += end - from;
    while (from < end) {
      const to = Math.min(end, nextRolloverMs(from));
      const key = dayKey(from);
      this.totals[key] = (this.totals[key] ?? 0) + (to - from);
      from = to;
    }
    this.countedUntilMs = end;
  }

  /** A stroke started or ended. */
  recordActivity(nowMs: number): void {
    this.accrue(nowMs);
    if (this.lastActivityMs === null || nowMs - this.lastActivityMs >= SESSION_BREAK_MS) this.sessionMs = 0;
    this.lastActivityMs = nowMs;
    this.countedUntilMs = Math.max(this.countedUntilMs, nowMs);
  }

  setVisible(visible: boolean, nowMs: number): void {
    if (visible === this.visible) return;
    if (!visible) this.accrue(nowMs);
    this.visible = visible;
    // Time while hidden is never counted.
    if (visible) this.countedUntilMs = Math.max(this.countedUntilMs, nowMs);
  }

  /** Current session time, counted up to now. */
  sessionTotalMs(nowMs: number): number {
    this.accrue(nowMs);
    if (this.lastActivityMs !== null && nowMs - this.lastActivityMs >= SESSION_BREAK_MS) return 0;
    return this.sessionMs;
  }

  todayTotalMs(nowMs: number): number {
    this.accrue(nowMs);
    return this.totals[dayKey(nowMs)] ?? 0;
  }

  /** A copy of the per-day totals, counted up to now, for saving. */
  snapshot(nowMs: number): DailyTotals {
    this.accrue(nowMs);
    return { ...this.totals };
  }
}

/** Session clock: "4:07" or "1:02:07". */
export function formatClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}` : `${minutes}:${pad(seconds % 60)}`;
}

/** Daily total in whole minutes, as you would type it into a time log: "41 min" or "1 h 05 min". */
export function formatMinutes(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min` : `${minutes} min`;
}
