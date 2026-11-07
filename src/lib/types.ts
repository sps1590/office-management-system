import type { Module, ModulePermissions } from "./modules";

export type TenantStatus = "trial" | "active" | "suspended" | "cancelled";
export type UserStatus = "active" | "invited" | "suspended" | "left";

export type TenantSummary = {
  id: string;
  company_name: string;
  slug: string;
  status: TenantStatus;
  plan_key: string;
  currency: string;
  timezone: string;
  logo_url: string | null;
};

/**
 * Everything a request needs to know about who is asking, resolved once per
 * request from the session cookie. `permissions` is already expanded to every
 * module/action pair, so callers never deal with a sparse matrix.
 */
export type SessionUser = {
  id: string;
  tenant_id: string;
  role_id: string | null;
  role_key: string | null;
  role_name: string | null;
  department_id: string | null;
  department_name: string | null;
  line_manager_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  employee_code: string | null;
  designation: string | null;
  avatar_url: string | null;
  status: UserStatus;
  locale: string;
  theme: string;
  is_platform_admin: boolean;
  tenant: TenantSummary;
  permissions: Record<Module, ModulePermissions>;
};

export type UserRow = {
  id: string;
  tenant_id: string;
  role_id: string | null;
  password_hash: string;
  full_name: string;
  email: string;
  status: UserStatus;
  is_platform_admin: boolean;
};

/** Tunable per-tenant configuration (one row per tenant). */
export type TenantSettings = {
  tenant_id: string;
  standard_work_minutes: number;
  work_start_time: string;
  grace_minutes: number;
  overtime_multiplier: number;
  overtime_after_minutes: number;
  weekend_days: number[];
  attendance_radius_meters: number;
  require_geofenced_checkin: boolean;
  telemetry_interval_seconds: number;
  telemetry_retention_days: number;
  tracking_window_start: string;
  tracking_window_end: string;
  deviation_threshold_meters: number;
  po_approval_tiers: { amount: number; role: string }[];
  leave_approval_stages: string[];
  fiscal_year_start_month: number;
  invoice_prefix: string;
  po_prefix: string;
};

/** Shape every Server Action returns to `useActionState`. */
export type ActionState = {
  error?: string;
  success?: string;
  /** Field-level messages keyed by input name, from a zod flatten(). */
  fieldErrors?: Record<string, string[]>;
  /**
   * Ways out of a refusal, drawn as buttons under the error. Clicking one
   * writes its `values` into the inputs of those names, so an action that
   * already knows the answer -- the next free slot for a double-booked room --
   * costs a click rather than a re-type.
   */
  suggestions?: { label: string; values: Record<string, string> }[];
} | null;

/**
 * What a spreadsheet import hands back.
 *
 * Deliberately not an `ActionState`: one `error` string cannot say "forty of
 * your forty-three rows went in, and here is what was wrong with the other
 * three". An import that refuses the whole file because of one bad cell makes
 * somebody bisect their own spreadsheet, so the valid rows are written and
 * the rest are reported by line number — the line number Excel shows, so it
 * can be found.
 */
export type ImportState = {
  error?: string;
  created?: number;
  updated?: number;
  /** `row` is the spreadsheet's own line number, header counted. */
  problems?: { row: number; message: string }[];
  /** Shown once, never stored: new accounts need a password handed over. */
  credentials?: { name: string; email: string; password: string }[];
  summary?: string;
} | null;

/**
 * One leave request as the month calendar needs it: who, which category, and
 * the span it covers, with everything the detail popover shows already
 * joined on. It lives here rather than in `leave.ts` because the calendar is
 * a client component and `leave.ts` is server-only.
 */
export type LeaveCalendarEntry = {
  id: string;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  employee_code: string | null;
  designation: string | null;
  department: string | null;
  leave_type: string;
  color: string;
  is_paid: boolean;
  /** Inclusive calendar days, as YYYY-MM-DD. */
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
  current_stage: number;
  total_stages: number;
  awaiting_name: string | null;
};
