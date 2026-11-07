import { weekdayOf } from "./utils";
import type { TenantSettings } from "./types";

/**
 * Working patterns: the pure arithmetic, with no database in it.
 *
 * Split from `shifts.ts` because `DayCheckboxes` renders DAY_NAMES in the
 * browser, and a module marked `server-only` cannot be reached from a client
 * component at all — importing one is a build error, not a runtime leak.
 * Everything here is a pure function of its arguments, so it is safe in both
 * places; everything that touches Postgres stayed behind.
 *
 * A company has one default pattern, held in `tenant_settings`: it starts at
 * `work_start_time`, runs for `standard_work_minutes`, and rests on
 * `weekend_days`. A *shift* overrides that for the people assigned to it.
 * Nothing here is required — a company that runs a single pattern creates no
 * shifts at all and every function below falls back to the settings.
 *
 * That fallback is the whole design. The alternative, giving everybody a
 * shift row at provisioning time, means a company that never opens this
 * screen still has to keep two places in step.
 */

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type Shift = {
  id: string;
  name: string;
  /** "HH:MM:SS" from Postgres TIME. */
  start_time: string;
  end_time: string;
  break_minutes: number;
  work_days: number[];
  grace_minutes: number | null;
  is_active: boolean;
  /** How many people are on it — only present on the listing query. */
  user_count?: number;
};

/** Minutes past midnight for a "HH:MM" or "HH:MM:SS" clock time. */
export function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * How long a shift is, in minutes, net of its unpaid break.
 *
 * A shift whose end is at or before its start crosses midnight — 22:00 to
 * 06:00 is eight hours, not minus sixteen — so the span wraps a day before
 * the break comes off.
 */
export function shiftMinutes(shift: Pick<Shift, "start_time" | "end_time" | "break_minutes">): number {
  const start = minutesOfDay(shift.start_time);
  const end = minutesOfDay(shift.end_time);
  const span = end > start ? end - start : end + 1440 - start;
  return Math.max(0, span - shift.break_minutes);
}

/** True when the shift runs past midnight into the next calendar day. */
export function crossesMidnight(shift: Pick<Shift, "start_time" | "end_time">): boolean {
  return minutesOfDay(shift.end_time) <= minutesOfDay(shift.start_time);
}

/**
 * What one person is expected to work on one calendar day.
 *
 * `null` for a shift means the company default. A non-working day returns
 * zero expected minutes, which is what keeps a weekend out of the timesheet's
 * shortfall column rather than counting as eight hours missed.
 */
export function expectedForDay(
  day: string,
  shift: Shift | null,
  settings: TenantSettings
): { working: boolean; minutes: number; startsAt: string } {
  const dow = weekdayOf(day);
  if (shift) {
    const working = shift.work_days.includes(dow);
    return {
      working,
      minutes: working ? shiftMinutes(shift) : 0,
      startsAt: shift.start_time.slice(0, 5),
    };
  }
  const working = !(settings.weekend_days ?? []).includes(dow);
  return {
    working,
    minutes: working ? settings.standard_work_minutes : 0,
    startsAt: settings.work_start_time.slice(0, 5),
  };
}

/** The grace period that applies to this person, shift first. */
export function graceFor(shift: Shift | null, settings: TenantSettings): number {
  return shift?.grace_minutes ?? settings.grace_minutes;
}

/** "Sun–Thu", or "Sun, Tue, Thu" when the days are not consecutive. */
export function workDaysLabel(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 0) return "No working days";
  if (sorted.length === 7) return "Every day";
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (consecutive && sorted.length > 2) {
    return `${DAY_NAMES[sorted[0]].slice(0, 3)}–${DAY_NAMES[sorted[sorted.length - 1]].slice(0, 3)}`;
  }
  return sorted.map((d) => DAY_NAMES[d].slice(0, 3)).join(", ");
}

/**
 * The weekday a calendar grid should begin on, 0 = Sunday.
 *
 * Not a constant and not a locale lookup: it is the company's own first
 * working day, so the weekend lands at the end of each row where people look
 * for it. A Friday/Saturday weekend gives a Sunday-start month; a
 * Saturday/Sunday one gives Monday. When the rest days are scattered rather
 * than a block — Tuesdays and Fridays off, say — there is no single answer,
 * and Sunday is as good as any.
 */
export function weekStartDay(weekendDays: number[] | null | undefined): number {
  const rest = new Set(weekendDays ?? []);
  if (rest.size === 0 || rest.size >= 7) return 0;
  const starts = [0, 1, 2, 3, 4, 5, 6].filter((d) => !rest.has(d) && rest.has((d + 6) % 7));
  return starts.length === 1 ? starts[0] : 0;
}
