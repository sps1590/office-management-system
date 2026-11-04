import "server-only";
import { getDb } from "./db";
import { getSettings } from "./settings";
import { evaluateFence, type Geofence, type Point } from "./geo";
import { isoDate } from "./utils";
import type { TenantSettings } from "./types";

export type AttendanceRow = {
  id: string;
  user_id: string;
  full_name: string;
  employee_code: string | null;
  department_name: string | null;
  work_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  worked_minutes: number;
  overtime_minutes: number;
  late_minutes: number;
  status: string;
  source: string;
  inside_geofence: boolean | null;
  note: string | null;
};

/* --- the attendance formula ------------------------------------------------
   SRS 3.4: "Records 8-hour tracking logs and computes custom overtime
   formulas." Both numbers come from tenant_settings, so a company on a
   nine-hour day or a 1.75x overtime rate needs no code change.
   -------------------------------------------------------------------------- */

export function computeLateMinutes(checkInAt: Date, settings: TenantSettings): number {
  const [h, m] = settings.work_start_time.split(":").map(Number);
  const expected = new Date(checkInAt);
  expected.setHours(h, (m ?? 0) + settings.grace_minutes, 0, 0);
  return Math.max(0, Math.round((checkInAt.getTime() - expected.getTime()) / 60_000));
}

export function computeWorkedMinutes(checkInAt: Date, checkOutAt: Date): number {
  return Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60_000));
}

export function computeOvertimeMinutes(
  workedMinutes: number,
  settings: TenantSettings
): number {
  return Math.max(0, workedMinutes - settings.overtime_after_minutes);
}

export function resolveStatus(
  workedMinutes: number,
  lateMinutes: number,
  settings: TenantSettings
): string {
  if (workedMinutes === 0) return "absent";
  if (workedMinutes < settings.standard_work_minutes / 2) return "half_day";
  return lateMinutes > 0 ? "late" : "present";
}

/**
 * Checks a coordinate against the tenant's office geofences.
 * Returns which fence matched, or null when none did.
 */
export async function matchOfficeGeofence(
  tenantId: string,
  point: Point
): Promise<{ geofenceId: string; name: string } | null> {
  const db = await getDb();
  const rows = await db`
    SELECT id, name, shape, center_lat, center_lng, radius_meters, polygon
      FROM geofences
     WHERE tenant_id = ${tenantId} AND is_active = TRUE
       AND kind IN ('office','warehouse')
  `;
  for (const row of rows as unknown as Geofence[]) {
    const { inside } = evaluateFence(point, row);
    if (inside) return { geofenceId: row.id, name: row.name };
  }
  return null;
}

/* --- queries -------------------------------------------------------------- */

/** Today's record for one user, or null before their first check-in. */
export async function todaysAttendance(
  tenantId: string,
  userId: string
): Promise<AttendanceRow | null> {
  const db = await getDb();
  const rows = await db`
    SELECT a.*, u.full_name, u.employee_code, d.name AS department_name
      FROM attendance_records a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN departments d ON d.id = u.department_id
     WHERE a.tenant_id = ${tenantId} AND a.user_id = ${userId}
       AND a.work_date = ${isoDate()}
  `;
  return (rows[0] as AttendanceRow | undefined) ?? null;
}

export async function attendanceForDate(
  tenantId: string,
  date: string,
  opts: { userId?: string; departmentId?: string } = {}
): Promise<AttendanceRow[]> {
  const db = await getDb();
  const rows = await db`
    SELECT a.*, u.full_name, u.employee_code, d.name AS department_name
      FROM attendance_records a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN departments d ON d.id = u.department_id
     WHERE a.tenant_id = ${tenantId}
       AND a.work_date = ${date}
       AND (${opts.userId ?? null}::uuid IS NULL OR a.user_id = ${opts.userId ?? null}::uuid)
       AND (${opts.departmentId ?? null}::uuid IS NULL OR u.department_id = ${opts.departmentId ?? null}::uuid)
     ORDER BY u.full_name
  `;
  return rows as unknown as AttendanceRow[];
}

/** One user's records over a date range — the "my attendance" view. */
export async function attendanceRange(
  tenantId: string,
  userId: string,
  from: string,
  to: string
): Promise<AttendanceRow[]> {
  const db = await getDb();
  const rows = await db`
    SELECT a.*, u.full_name, u.employee_code, NULL::text AS department_name
      FROM attendance_records a
      JOIN users u ON u.id = a.user_id
     WHERE a.tenant_id = ${tenantId} AND a.user_id = ${userId}
       AND a.work_date BETWEEN ${from} AND ${to}
     ORDER BY a.work_date DESC
  `;
  return rows as unknown as AttendanceRow[];
}

/** Headcount present / late / absent for a single day. */
export async function attendanceSummary(tenantId: string, date: string) {
  const db = await getDb();
  const rows = await db`
    SELECT
      (SELECT COUNT(*)::int FROM users
        WHERE tenant_id = ${tenantId} AND status = 'active')              AS headcount,
      COUNT(*) FILTER (WHERE status IN ('present','late'))::int           AS present,
      COUNT(*) FILTER (WHERE status = 'late')::int                        AS late,
      COUNT(*) FILTER (WHERE status = 'on_leave')::int                    AS on_leave,
      COUNT(*) FILTER (WHERE check_out_at IS NULL
                         AND check_in_at IS NOT NULL)::int                AS still_in,
      COALESCE(SUM(overtime_minutes), 0)::int                             AS overtime_minutes
      FROM attendance_records
     WHERE tenant_id = ${tenantId} AND work_date = ${date}
  `;
  const r = rows[0] as {
    headcount: number;
    present: number;
    late: number;
    on_leave: number;
    still_in: number;
    overtime_minutes: number;
  };
  return { ...r, absent: Math.max(0, r.headcount - r.present - r.on_leave) };
}

/** Daily present-count for the last `days` days, for the trend chart. */
export async function attendanceTrend(
  tenantId: string,
  days = 14
): Promise<{ label: string; value: number }[]> {
  const db = await getDb();
  // generate_series gives a row for every day, so days with no attendance at
  // all still appear as zero instead of vanishing from the chart.
  const rows = await db`
    SELECT to_char(d.day, 'DD Mon') AS label,
           COUNT(a.id) FILTER (WHERE a.status IN ('present','late'))::int AS value
      FROM generate_series(CURRENT_DATE - ${days - 1}::int, CURRENT_DATE, '1 day') AS d(day)
      LEFT JOIN attendance_records a
             ON a.work_date = d.day AND a.tenant_id = ${tenantId}
     GROUP BY d.day
     ORDER BY d.day
  `;
  return rows as unknown as { label: string; value: number }[];
}

/** Monthly totals per employee, the basis of a payroll run. */
export async function monthlyAttendanceTotals(
  tenantId: string,
  year: number,
  month: number
): Promise<
  {
    user_id: string;
    present_days: number;
    leave_days: number;
    absent_days: number;
    overtime_minutes: number;
  }[]
> {
  const db = await getDb();
  const rows = await db`
    SELECT user_id,
           COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS present_days,
           COUNT(*) FILTER (WHERE status = 'on_leave')::int          AS leave_days,
           COUNT(*) FILTER (WHERE status = 'absent')::int            AS absent_days,
           COALESCE(SUM(overtime_minutes), 0)::int                   AS overtime_minutes
      FROM attendance_records
     WHERE tenant_id = ${tenantId}
       AND EXTRACT(YEAR FROM work_date) = ${year}
       AND EXTRACT(MONTH FROM work_date) = ${month}
     GROUP BY user_id
  `;
  return rows as unknown as {
    user_id: string;
    present_days: number;
    leave_days: number;
    absent_days: number;
    overtime_minutes: number;
  }[];
}

/** Re-exported so actions do not need a second import for the formula inputs. */
export { getSettings };
