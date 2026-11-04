import "server-only";
import { getDb } from "./db";
import type { TenantSettings } from "./types";

/**
 * Reads the tenant's tunable settings, creating the row if a tenant somehow
 * predates it. Every formula in the system (overtime, geofence radius,
 * telemetry duty cycle, approval chains) reads from here rather than hard
 * coding a number, so an administrator can change policy without a deploy.
 */
export async function getSettings(tenantId: string): Promise<TenantSettings> {
  const db = await getDb();
  const rows = await db`
    SELECT * FROM tenant_settings WHERE tenant_id = ${tenantId}
  `;
  if (rows.length === 0) {
    await db`INSERT INTO tenant_settings (tenant_id) VALUES (${tenantId})
             ON CONFLICT (tenant_id) DO NOTHING`;
    const retry = await db`
      SELECT * FROM tenant_settings WHERE tenant_id = ${tenantId}
    `;
    return normalise(retry[0]);
  }
  return normalise(rows[0]);
}

// Postgres NUMERIC comes back as a string over the HTTP driver, and JSONB as
// a parsed value. Normalise once here so every caller gets real numbers.
function normalise(row: Record<string, unknown>): TenantSettings {
  return {
    tenant_id: String(row.tenant_id),
    standard_work_minutes: Number(row.standard_work_minutes),
    work_start_time: String(row.work_start_time),
    grace_minutes: Number(row.grace_minutes),
    overtime_multiplier: Number(row.overtime_multiplier),
    overtime_after_minutes: Number(row.overtime_after_minutes),
    weekend_days: (row.weekend_days as number[]) ?? [5, 6],
    attendance_radius_meters: Number(row.attendance_radius_meters),
    require_geofenced_checkin: Boolean(row.require_geofenced_checkin),
    telemetry_interval_seconds: Number(row.telemetry_interval_seconds),
    telemetry_retention_days: Number(row.telemetry_retention_days),
    tracking_window_start: String(row.tracking_window_start),
    tracking_window_end: String(row.tracking_window_end),
    deviation_threshold_meters: Number(row.deviation_threshold_meters),
    po_approval_tiers:
      (row.po_approval_tiers as { amount: number; role: string }[]) ?? [],
    leave_approval_stages: (row.leave_approval_stages as string[]) ?? [],
    fiscal_year_start_month: Number(row.fiscal_year_start_month),
    invoice_prefix: String(row.invoice_prefix),
    po_prefix: String(row.po_prefix),
  };
}
