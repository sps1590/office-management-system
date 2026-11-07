import "server-only";
import { getDb } from "./db";
import { getSettings } from "./settings";
import { evaluateFence, type Geofence, type Point } from "./geo";
import { expectedForDay, graceFor, shiftMinutes, type Shift } from "./work-pattern";
import { addDays, isoDate, weekdayOf, zonedToInstant } from "./utils";
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

export function computeLateMinutes(
  checkInAt: Date,
  settings: TenantSettings,
  timeZone: string,
  shift: Shift | null = null
): number {
  // The shift's own start, when the person is on one. Without this a night
  // shift beginning at 22:00 is thirteen hours late against a 09:00 company
  // default, every single night.
  const [h, m] = (shift?.start_time ?? settings.work_start_time).split(":").map(Number);
  // "Work starts at 09:00" means nine where the office is. Building the
  // expected moment with setHours would read the server's clock instead --
  // UTC on Vercel -- and mark a Dhaka office six hours late every morning.
  const startOfShift = zonedToInstant(
    `${isoDate(timeZone, checkInAt)}T${String(h || 0).padStart(2, "0")}:${String(
      m ?? 0
    ).padStart(2, "0")}`,
    timeZone
  );
  const grace = graceFor(shift, settings) * 60_000;
  return Math.max(
    0,
    Math.round((checkInAt.getTime() - startOfShift.getTime() - grace) / 60_000)
  );
}

export function computeWorkedMinutes(checkInAt: Date, checkOutAt: Date): number {
  return Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60_000));
}

export function computeOvertimeMinutes(
  workedMinutes: number,
  settings: TenantSettings,
  shift: Shift | null = null
): number {
  // Somebody on a six-hour shift earns overtime after six hours, not after
  // the company's eight.
  const threshold = shift ? shiftMinutes(shift) : settings.overtime_after_minutes;
  return Math.max(0, workedMinutes - threshold);
}

export function resolveStatus(
  workedMinutes: number,
  lateMinutes: number,
  settings: TenantSettings,
  shift: Shift | null = null
): string {
  if (workedMinutes === 0) return "absent";
  const fullDay = shift ? shiftMinutes(shift) : settings.standard_work_minutes;
  if (workedMinutes < fullDay / 2) return "half_day";
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
  userId: string,
  timeZone: string
): Promise<AttendanceRow | null> {
  const db = await getDb();
  const rows = await db`
    SELECT a.*, u.full_name, u.employee_code, d.name AS department_name
      FROM attendance_records a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN departments d ON d.id = u.department_id
     WHERE a.tenant_id = ${tenantId} AND a.user_id = ${userId}
       AND a.work_date = ${isoDate(timeZone)}
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
  timeZone: string,
  days = 14
): Promise<{ label: string; value: number }[]> {
  const db = await getDb();
  // The axis ends on the company's today, not the server's: CURRENT_DATE is
  // the database's UTC day, which is yesterday for an office in Dhaka until
  // six in the morning.
  const today = isoDate(timeZone);
  // generate_series gives a row for every day, so days with no attendance at
  // all still appear as zero instead of vanishing from the chart.
  const rows = await db`
    SELECT to_char(d.day, 'DD Mon') AS label,
           COUNT(a.id) FILTER (WHERE a.status IN ('present','late'))::int AS value
      FROM generate_series(${today}::date - ${days - 1}::int, ${today}::date, '1 day') AS d(day)
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

/* --- the timesheet -------------------------------------------------------- */

export type TimesheetDay = {
  date: string;
  weekday: number;
  /** Whether this person was meant to work at all. */
  working: boolean;
  holidayName: string | null;
  expectedMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  checkInAt: string | null;
  checkOutAt: string | null;
  leaveType: string | null;
  /**
   * present | late | half_day | absent | on_leave | holiday | rest_day |
   * scheduled (a working day that has not happened yet).
   */
  status: string;
};

export type Timesheet = {
  days: TimesheetDay[];
  shiftName: string | null;
  totals: {
    expectedMinutes: number;
    workedMinutes: number;
    overtimeMinutes: number;
    lateMinutes: number;
    balanceMinutes: number;
    workingDays: number;
    presentDays: number;
    absentDays: number;
    leaveDays: number;
    restDays: number;
  };
};

/**
 * One person's expected-versus-actual hours, day by day.
 *
 * This is the screen the shift configuration exists for. Until it was built,
 * "My attendance" listed only the days somebody checked in, so a month with
 * four missed days looked exactly like a month with none — the absences were
 * invisible because they had no row. A timesheet has to start from the
 * calendar and ask what happened on each day, not start from the records.
 *
 * Expected minutes come from the person's shift, or the company default when
 * they have none, and a rest day or public holiday expects zero — which is
 * what keeps a weekend out of the shortfall. Days after today are marked
 * `scheduled` and left out of every total, so the balance on the 10th of the
 * month is not twenty days in deficit.
 *
 * The per-day totals are summed in JavaScript rather than SQL, against this
 * project's usual rule. The rule is there to stop a query pulling thousands
 * of rows back to count them; here the rows are the output — every one is
 * rendered — and the expected side depends on shift arithmetic (the midnight
 * wrap, the unpaid break, the work_days set) that would have to be
 * reimplemented in SQL to move the sum there.
 */
export async function timesheet(
  tenantId: string,
  userId: string,
  from: string,
  to: string,
  settings: TenantSettings,
  shift: Shift | null,
  timeZone: string
): Promise<Timesheet> {
  const db = await getDb();
  const [records, leave, holidays] = await Promise.all([
    db`
      SELECT work_date, check_in_at, check_out_at, worked_minutes,
             overtime_minutes, late_minutes, status
        FROM attendance_records
       WHERE tenant_id = ${tenantId} AND user_id = ${userId}
         AND work_date BETWEEN ${from} AND ${to}
    `,
    db`
      SELECT lr.start_date, lr.end_date, lt.name AS leave_type
        FROM leave_requests lr
        JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.tenant_id = ${tenantId} AND lr.user_id = ${userId}
         AND lr.status = 'approved'
         AND lr.start_date <= ${to} AND lr.end_date >= ${from}
    `,
    db`
      SELECT holiday_date, name FROM holidays
       WHERE tenant_id = ${tenantId} AND holiday_date BETWEEN ${from} AND ${to}
    `,
  ]);

  const byDate = new Map(
    (records as unknown as AttendanceRow[]).map((r) => [r.work_date, r])
  );
  const holidayByDate = new Map(
    (holidays as unknown as { holiday_date: string; name: string }[]).map((h) => [
      h.holiday_date,
      h.name,
    ])
  );
  // A leave request is a range, so it is expanded onto the days it covers
  // rather than looked up by start date.
  const leaveByDate = new Map<string, string>();
  for (const l of leave as unknown as {
    start_date: string;
    end_date: string;
    leave_type: string;
  }[]) {
    for (let d = l.start_date; d <= l.end_date; d = addDays(d, 1)) {
      if (d >= from && d <= to) leaveByDate.set(d, l.leave_type);
    }
  }

  const today = isoDate(timeZone);
  const days: TimesheetDay[] = [];

  for (let d = from; d <= to; d = addDays(d, 1)) {
    const expected = expectedForDay(d, shift, settings);
    const rec = byDate.get(d);
    const holidayName = holidayByDate.get(d) ?? null;
    const leaveType = leaveByDate.get(d) ?? null;
    const working = expected.working && !holidayName;

    let status: string;
    if (holidayName) status = "holiday";
    else if (!expected.working) status = "rest_day";
    else if (leaveType) status = "on_leave";
    else if (rec) status = rec.status;
    else if (d > today) status = "scheduled";
    else status = "absent";

    days.push({
      date: d,
      weekday: weekdayOf(d),
      working,
      holidayName,
      // A day on approved leave was still a working day, but nothing is owed
      // for it — the leave balance has already paid for it.
      expectedMinutes: working && !leaveType ? expected.minutes : 0,
      workedMinutes: rec?.worked_minutes ?? 0,
      overtimeMinutes: rec?.overtime_minutes ?? 0,
      lateMinutes: rec?.late_minutes ?? 0,
      checkInAt: rec?.check_in_at ?? null,
      checkOutAt: rec?.check_out_at ?? null,
      leaveType,
      status,
    });
  }

  // Only days that have happened count towards the balance.
  const settled = days.filter((d) => d.date <= today);
  const sum = (pick: (d: TimesheetDay) => number) => settled.reduce((s, d) => s + pick(d), 0);
  const expectedMinutes = sum((d) => d.expectedMinutes);
  const workedMinutes = sum((d) => d.workedMinutes);

  return {
    days,
    shiftName: shift?.name ?? null,
    totals: {
      expectedMinutes,
      workedMinutes,
      overtimeMinutes: sum((d) => d.overtimeMinutes),
      lateMinutes: sum((d) => d.lateMinutes),
      balanceMinutes: workedMinutes - expectedMinutes,
      workingDays: settled.filter((d) => d.working).length,
      presentDays: settled.filter((d) => ["present", "late", "half_day"].includes(d.status)).length,
      absentDays: settled.filter((d) => d.status === "absent").length,
      leaveDays: settled.filter((d) => d.status === "on_leave").length,
      restDays: settled.filter((d) => ["rest_day", "holiday"].includes(d.status)).length,
    },
  };
}

/** Re-exported so actions do not need a second import for the formula inputs. */
export { getSettings };
