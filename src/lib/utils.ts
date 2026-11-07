// Small helpers shared by server and client code. Deliberately dependency
// free: these few functions replace clsx and a date library.

/** Conditional class names. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// --- money and numbers -----------------------------------------------------

export function money(amount: number | string | null | undefined, currency = "BDT"): string {
  const n = Number(amount ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  }).format(n);
}

/** Compact form for KPI tiles: 1.2M, 45.3K. */
export function compact(amount: number | string | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(amount ?? 0));
}

export function num(value: number | string | null | undefined, digits = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value ?? 0));
}

export function percent(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

// --- time zones and dates --------------------------------------------------

/*
   Every company keeps its own clock. `tenants.timezone` is what an office in
   Dhaka, Dubai or Toronto means by "ten o'clock"; the server's clock is an
   accident of hosting -- UTC on Vercel, Asia/Dhaka on a laptop -- and must
   never reach a screen. So a zone is passed in wherever a wall clock is read
   or written, exactly as `money()` is passed the tenant's currency.

   Two column kinds, two rules:

   - TIMESTAMPTZ holds an instant. It is stored as the true moment and is
     rendered through the tenant's zone.
   - DATE holds a calendar day with no zone at all. Pushing one through a
     zone is how "08 Nov" becomes "07 Nov" for anyone west of UTC, so a bare
     YYYY-MM-DD is always read back as itself, whatever zone is passed.

   `Intl` resolves the offset per instant, which makes this correct across
   daylight saving without a date library.
*/

const zoneCache = new Map<string, string>();

/** Falls back to UTC rather than throwing on a zone `Intl` does not know. */
function safeZone(timeZone: string | null | undefined): string {
  const wanted = timeZone?.trim() || "UTC";
  const cached = zoneCache.get(wanted);
  if (cached) return cached;
  let resolved = "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: wanted });
    resolved = wanted;
  } catch {
    // A tenant can type its own timezone in Settings; a typo must not take
    // every page down with a RangeError.
  }
  zoneCache.set(wanted, resolved);
  return resolved;
}

/** Zone validity on its own, for validating what Settings submits. */
export function isKnownTimeZone(timeZone: string): boolean {
  return safeZone(timeZone) === timeZone.trim();
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(kind: string, zone: string, options: Intl.DateTimeFormatOptions) {
  const key = `${kind}|${zone}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: zone });
    formatters.set(key, f);
  }
  return f;
}

type Wall = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

/** The wall-clock fields an instant shows as in `zone`. */
function wallParts(instant: Date, zone: string): Wall {
  const out: Record<string, string> = {};
  for (const part of formatter("parts", zone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant)) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  return out as unknown as Wall;
}

function offsetMs(instant: Date, zone: string): number {
  const w = wallParts(instant, zone);
  return (
    Date.UTC(+w.year, +w.month - 1, +w.day, +w.hour, +w.minute, +w.second) -
    instant.getTime()
  );
}

function asDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * The instant a `datetime-local` value names in `timeZone`.
 *
 * Without this the typed string reaches a TIMESTAMPTZ unqualified and
 * Postgres reads it in the *session* zone, so "10:00" booked from Dhaka is
 * stored as 10:00 UTC -- four o'clock in the afternoon, locally.
 *
 * Resolved twice because the offset depends on the instant and the instant
 * on the offset: the first pass lands within an hour, the second is exact.
 */
export function zonedToInstant(wallClock: string, timeZone: string): Date {
  const zone = safeZone(timeZone);
  const naive = Date.parse(`${wallClock.trim().replace(" ", "T").replace(/Z$/, "")}Z`);
  if (Number.isNaN(naive)) return new Date(NaN);
  const once = naive - offsetMs(new Date(naive), zone);
  return new Date(naive - offsetMs(new Date(once), zone));
}

/**
 * A `datetime-local` value as the ISO instant to hand a TIMESTAMPTZ column,
 * or null when the field was left empty.
 */
export function zonedToSql(
  wallClock: string | null | undefined,
  timeZone: string
): string | null {
  if (!wallClock) return null;
  const at = zonedToInstant(wallClock, timeZone);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** The `datetime-local` value an instant shows as in `timeZone`. */
export function instantToZoned(value: string | Date, timeZone: string): string {
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return "";
  const w = wallParts(d, safeZone(timeZone));
  return `${w.year}-${w.month}-${w.day}T${w.hour}:${w.minute}`;
}

/** YYYY-MM-DD for a DATE column: the calendar day where the company is. */
export function isoDate(timeZone: string, at: Date = new Date()): string {
  const w = wallParts(at, safeZone(timeZone));
  return `${w.year}-${w.month}-${w.day}`;
}

// --- the company's calendar -------------------------------------------------

/*
   A counter that says "today", "this month" or "overdue" has to mean it where
   the company is. Postgres's CURRENT_DATE is the database session's day --
   UTC on Neon -- so a Dhaka office read yesterday's figures until 06:00, and
   a Toronto one tomorrow's after 19:00: an invoice due today was already
   counted overdue, and a deal won on the 1st landed in last month's total.

   So the boundaries are computed here from the tenant's zone and passed into
   SQL as ordinary values -- a YYYY-MM-DD for a DATE column, an ISO instant
   for a TIMESTAMPTZ one. Both are stable for the life of a request, which
   `CURRENT_DATE` within a multi-query page was not.
*/

/** `day` shifted by `n` days, both as YYYY-MM-DD. */
export function addDays(day: string, n: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + n);
  return at.toISOString().slice(0, 10);
}

/**
 * Which day of the week a calendar day falls on — 0 = Sunday, the numbering
 * `tenant_settings.weekend_days` and `shifts.work_days` are both written for.
 *
 * No time zone is applied, and none should be: which weekday 2026-11-07 is
 * does not depend on where you stand. Reading it through a zone is how a
 * Friday becomes a Thursday for a tenant west of the server.
 */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** The instant a calendar day begins where the company is. */
export function dayStart(day: string, timeZone: string): string {
  return zonedToInstant(`${day}T00:00`, timeZone).toISOString();
}

export type CalendarBounds = {
  /** The company's current calendar day, for comparing a DATE column. */
  today: string;
  /** First day of the company's current month and year, as calendar days. */
  monthStart: string;
  yearStart: string;
  /** The company's current year, for an EXTRACT(YEAR …) comparison. */
  year: number;
  /** The same boundaries as instants, for comparing a TIMESTAMPTZ column. */
  dayStartAt: string;
  weekStartAt: string;
  monthStartAt: string;
  yearStartAt: string;
};

/** Every boundary a counter needs, in the company's own calendar. */
export function calendarBounds(timeZone: string, at: Date = new Date()): CalendarBounds {
  const today = isoDate(timeZone, at);
  const monthStart = `${today.slice(0, 7)}-01`;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  // Weeks start on Monday, as Postgres's date_trunc('week', …) had them.
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const weekStart = addDays(today, -((weekday + 6) % 7));
  return {
    today,
    monthStart,
    yearStart,
    year: Number(today.slice(0, 4)),
    dayStartAt: dayStart(today, timeZone),
    weekStartAt: dayStart(weekStart, timeZone),
    monthStartAt: dayStart(monthStart, timeZone),
    yearStartAt: dayStart(yearStart, timeZone),
  };
}

/** True when the value is a bare DATE, which carries no zone to convert. */
const isCalendarDay = (value: string | Date) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export function formatDate(
  value: string | Date | null | undefined,
  timeZone: string
): string {
  if (!value) return "—";
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return formatter("date", isCalendarDay(value) ? "UTC" : safeZone(timeZone), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function formatDateTime(
  value: string | Date | null | undefined,
  timeZone: string
): string {
  if (!value) return "—";
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return formatter("datetime", isCalendarDay(value) ? "UTC" : safeZone(timeZone), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

export function formatTime(
  value: string | Date | null | undefined,
  timeZone: string
): string {
  if (!value) return "—";
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return formatter("time", safeZone(timeZone), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** "3 hours ago", for activity feeds. */
export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  const table: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2629800, "week"],
    [31557600, "month"],
    [Infinity, "year"],
  ];
  const divisors = [1, 60, 3600, 86400, 604800, 2629800, 31557600];
  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (let i = 0; i < table.length; i++) {
    if (Math.abs(seconds) < table[i][0]) {
      return fmt.format(-Math.round(seconds / divisors[i]), table[i][1]);
    }
  }
  return fmt.format(-Math.round(seconds / 31557600), "year");
}

/** Whole minutes as "7h 30m". */
export function duration(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(Number(minutes ?? 0)));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

/** Inclusive count of days between two YYYY-MM-DD strings. */
export function daysBetween(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

export function monthName(month: number): string {
  return new Date(2000, month - 1, 1).toLocaleDateString("en-GB", { month: "long" });
}

// --- text ------------------------------------------------------------------

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** URL-safe slug, used for tenant subdomain-style identifiers. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
