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

// --- dates -----------------------------------------------------------------

/** YYYY-MM-DD in local time — what every DATE column stores. */
export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
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
  const a = new Date(`${start}T00:00:00`).getTime();
  const b = new Date(`${end}T00:00:00`).getTime();
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
