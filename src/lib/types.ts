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
} | null;
