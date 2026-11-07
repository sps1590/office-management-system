import "server-only";
import { getDb } from "./db";
import { calendarBounds } from "./utils";
import type { LeaveCalendarEntry } from "./types";

export type LeaveRequestRow = {
  id: string;
  user_id: string;
  full_name: string;
  employee_code: string | null;
  leave_type_id: string;
  leave_type: string;
  color: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
  current_stage: number;
  total_stages: number;
  created_at: string;
  decided_at: string | null;
  /** Who the request is waiting on right now, when it is pending. */
  awaiting_name: string | null;
  awaiting_id: string | null;
};

export async function listLeaveTypes(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT id, key, name, annual_quota::float AS annual_quota, is_paid,
           requires_document, color, sort_order, is_active
      FROM leave_types
     WHERE tenant_id = ${tenantId}
     ORDER BY sort_order, name
  `;
  return rows as unknown as {
    id: string;
    key: string;
    name: string;
    annual_quota: number;
    is_paid: boolean;
    requires_document: boolean;
    color: string;
    sort_order: number;
    is_active: boolean;
  }[];
}

/**
 * Entitlement, taken and remaining per leave type for one employee.
 *
 * "Taken" is computed from approved requests rather than read from
 * leave_balances.used, so the number can never drift out of step with the
 * requests that produced it.
 */
export async function leaveBalances(tenantId: string, userId: string, year: number) {
  const db = await getDb();
  const rows = await db`
    SELECT lt.id, lt.name, lt.color, lt.is_paid,
           COALESCE(lb.entitled, lt.annual_quota)::float AS entitled,
           COALESCE(lb.carried_forward, 0)::float        AS carried_forward,
           COALESCE((
             SELECT SUM(lr.days) FROM leave_requests lr
              WHERE lr.tenant_id = ${tenantId}
                AND lr.user_id = ${userId}
                AND lr.leave_type_id = lt.id
                AND lr.status = 'approved'
                AND EXTRACT(YEAR FROM lr.start_date) = ${year}
           ), 0)::float                                  AS taken
      FROM leave_types lt
      LEFT JOIN leave_balances lb
             ON lb.leave_type_id = lt.id AND lb.user_id = ${userId}
            AND lb.year = ${year} AND lb.tenant_id = ${tenantId}
     WHERE lt.tenant_id = ${tenantId} AND lt.is_active = TRUE
     ORDER BY lt.sort_order, lt.name
  `;
  return rows as unknown as {
    id: string;
    name: string;
    color: string;
    is_paid: boolean;
    entitled: number;
    carried_forward: number;
    taken: number;
  }[];
}

export async function listLeaveRequests(
  tenantId: string,
  filters: { userId?: string; status?: string; awaitingUserId?: string } = {}
): Promise<LeaveRequestRow[]> {
  const db = await getDb();
  const rows = await db`
    SELECT lr.*, u.full_name, u.employee_code,
           lt.name AS leave_type, lt.color,
           aw.full_name AS awaiting_name, aw.id AS awaiting_id
      FROM leave_requests lr
      JOIN users u       ON u.id = lr.user_id
      JOIN leave_types lt ON lt.id = lr.leave_type_id
      LEFT JOIN leave_approvals la
             ON la.leave_request_id = lr.id AND la.stage = lr.current_stage
            AND lr.status = 'pending'
      LEFT JOIN users aw ON aw.id = la.approver_id
     WHERE lr.tenant_id = ${tenantId}
       AND (${filters.userId ?? null}::uuid IS NULL OR lr.user_id = ${filters.userId ?? null}::uuid)
       AND (${filters.status ?? null}::text IS NULL OR lr.status = ${filters.status ?? null})
       AND (${filters.awaitingUserId ?? null}::uuid IS NULL
            OR (lr.status = 'pending' AND la.approver_id = ${filters.awaitingUserId ?? null}::uuid
                AND la.decision = 'pending'))
     ORDER BY lr.created_at DESC
     LIMIT 200
  `;
  return rows as unknown as LeaveRequestRow[];
}

/** The decision trail for one request, in stage order. */
export async function leaveApprovalTrail(tenantId: string, requestId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT la.stage, la.decision, la.comments, la.decided_at, la.approver_role,
           u.full_name AS approver_name
      FROM leave_approvals la
      LEFT JOIN users u ON u.id = la.approver_id
     WHERE la.tenant_id = ${tenantId} AND la.leave_request_id = ${requestId}
     ORDER BY la.stage
  `;
  return rows as unknown as {
    stage: number;
    decision: string;
    comments: string | null;
    decided_at: string | null;
    approver_role: string | null;
    approver_name: string | null;
  }[];
}

export async function leaveStats(tenantId: string, timeZone: string) {
  const db = await getDb();
  const cal = calendarBounds(timeZone);
  const rows = await db`
    SELECT COUNT(*) FILTER (WHERE status = 'pending')::int   AS pending,
           COUNT(*) FILTER (WHERE status = 'approved'
             AND start_date <= ${cal.today}::date
             AND end_date >= ${cal.today}::date)::int AS on_leave_today,
           COUNT(*) FILTER (WHERE status = 'approved'
             AND EXTRACT(YEAR FROM start_date) = ${cal.year})::int AS approved_this_year,
           COALESCE(SUM(days) FILTER (WHERE status = 'approved'
             AND EXTRACT(YEAR FROM start_date) = ${cal.year}), 0)::float AS days_this_year
      FROM leave_requests WHERE tenant_id = ${tenantId}
  `;
  return rows[0] as {
    pending: number;
    on_leave_today: number;
    approved_this_year: number;
    days_this_year: number;
  };
}

/*
   LeaveCalendarEntry itself lives in types.ts, not here: the calendar that
   renders it is a client component, and a type imported from a module that
   begins `import "server-only"` is a build error waiting for the first person
   who forgets the `type` keyword.
*/
export type { LeaveCalendarEntry } from "./types";

/**
 * Every leave that touches the window, for the month calendar.
 *
 * The predicate is an overlap test, not a containment one: a leave that began
 * in October and runs to the 4th of November belongs on November's calendar,
 * and `start_date BETWEEN from AND to` would silently drop exactly the
 * absences a planner most needs to see.
 *
 * Pending requests come back alongside approved ones, drawn differently, so
 * an approver can see the clash before they decide rather than after.
 * Rejected and cancelled requests are nobody's absence and are left out.
 */
export async function leaveCalendar(
  tenantId: string,
  from: string,
  to: string
): Promise<LeaveCalendarEntry[]> {
  const db = await getDb();
  const rows = await db`
    SELECT lr.id, lr.user_id, lr.start_date, lr.end_date, lr.days::float AS days,
           lr.reason, lr.status, lr.current_stage, lr.total_stages,
           u.full_name, u.avatar_url, u.employee_code, u.designation,
           d.name AS department,
           lt.name AS leave_type, lt.color, lt.is_paid,
           aw.full_name AS awaiting_name
      FROM leave_requests lr
      JOIN users u        ON u.id = lr.user_id
      JOIN leave_types lt ON lt.id = lr.leave_type_id
      LEFT JOIN departments d ON d.id = u.department_id
      LEFT JOIN leave_approvals la
             ON la.leave_request_id = lr.id AND la.stage = lr.current_stage
            AND lr.status = 'pending'
      LEFT JOIN users aw ON aw.id = la.approver_id
     WHERE lr.tenant_id = ${tenantId}
       AND lr.status IN ('approved', 'pending')
       AND lr.start_date <= ${to}::date
       AND lr.end_date   >= ${from}::date
     ORDER BY lr.start_date, u.full_name
     LIMIT 500
  `;
  return rows as unknown as LeaveCalendarEntry[];
}

/**
 * Who is actually away right now, with the department each absence is felt in.
 *
 * Its own query rather than a filter over `leaveCalendar`, because "today" must
 * not move when somebody pages the calendar back to August. Approved only:
 * a pending request is not yet an absence anyone can plan cover around.
 */
export async function onLeaveToday(
  tenantId: string,
  today: string
): Promise<LeaveCalendarEntry[]> {
  const db = await getDb();
  const rows = await db`
    SELECT lr.id, lr.user_id, lr.start_date, lr.end_date, lr.days::float AS days,
           lr.reason, lr.status, lr.current_stage, lr.total_stages,
           u.full_name, u.avatar_url, u.employee_code, u.designation,
           d.name AS department,
           lt.name AS leave_type, lt.color, lt.is_paid,
           NULL::text AS awaiting_name
      FROM leave_requests lr
      JOIN users u        ON u.id = lr.user_id
      JOIN leave_types lt ON lt.id = lr.leave_type_id
      LEFT JOIN departments d ON d.id = u.department_id
     WHERE lr.tenant_id = ${tenantId}
       AND lr.status = 'approved'
       AND lr.start_date <= ${today}::date
       AND lr.end_date   >= ${today}::date
     ORDER BY d.name NULLS LAST, u.full_name
  `;
  return rows as unknown as LeaveCalendarEntry[];
}

/**
 * The company's public holidays inside a window.
 *
 * A leave calendar that does not show them invites somebody to approve cover
 * for a day the office is shut. `attendance.ts` reads the same table inside
 * its own parallel batch, where it is one of three queries that must fire
 * together.
 */
export async function holidaysBetween(tenantId: string, from: string, to: string) {
  const db = await getDb();
  const rows = await db`
    SELECT holiday_date, name
      FROM holidays
     WHERE tenant_id = ${tenantId}
       AND holiday_date BETWEEN ${from}::date AND ${to}::date
     ORDER BY holiday_date
  `;
  return rows as unknown as { holiday_date: string; name: string }[];
}
