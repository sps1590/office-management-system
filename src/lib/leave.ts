import "server-only";
import { getDb } from "./db";
import { calendarBounds } from "./utils";

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
