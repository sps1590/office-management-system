import "server-only";
import { getDb } from "./db";
import { attendanceSummary, attendanceTrend } from "./attendance";
import { isoDate } from "./utils";

/**
 * One data load for the whole dashboard. Every query runs concurrently in a
 * single Promise.all, so the page costs one round-trip's worth of latency
 * rather than fifteen sequential ones.
 *
 * Counts the user is not allowed to see are still fetched (they are cheap
 * aggregates with no row data) but the page only renders the sections the
 * user's role permits.
 */
export async function loadDashboard(tenantId: string, userId: string) {
  const db = await getDb();
  const today = isoDate();

  const [
    attendance,
    trend,
    myPendingApprovals,
    myTasks,
    fleet,
    inventory,
    pipeline,
    receivables,
    payables,
    expenses,
    leavePending,
    poPending,
    fieldActive,
    activity,
    monthlyCash,
  ] = await Promise.all([
    attendanceSummary(tenantId, today),
    attendanceTrend(tenantId, 14),

    // "Waiting on me": leave stages and PO tiers assigned to this user.
    db`
      SELECT
        (SELECT COUNT(*)::int FROM leave_approvals la
          JOIN leave_requests lr ON lr.id = la.leave_request_id
         WHERE la.tenant_id = ${tenantId} AND la.approver_id = ${userId}
           AND la.decision = 'pending' AND lr.status = 'pending'
           AND la.stage = lr.current_stage)                                AS leave_count,
        (SELECT COUNT(*)::int FROM po_approvals pa
          JOIN purchase_orders po ON po.id = pa.purchase_order_id
         WHERE pa.tenant_id = ${tenantId} AND pa.approver_id = ${userId}
           AND pa.decision = 'pending' AND po.status = 'pending'
           AND pa.tier = po.current_tier)                                  AS po_count
    `,

    db`
      SELECT id, title, priority, status, due_date
        FROM tasks
       WHERE tenant_id = ${tenantId} AND assigned_to = ${userId}
         AND status IN ('todo','in_progress','review')
       ORDER BY (due_date IS NULL), due_date, created_at DESC
       LIMIT 6
    `,

    db`
      SELECT COUNT(*)::int                                            AS total,
             COUNT(*) FILTER (WHERE status = 'in_use')::int            AS in_use,
             COUNT(*) FILTER (WHERE status = 'maintenance')::int       AS maintenance,
             COUNT(*) FILTER (WHERE status = 'available')::int         AS available,
             COUNT(*) FILTER (WHERE insurance_expiry IS NOT NULL
                                AND insurance_expiry < CURRENT_DATE + 30)::int AS docs_expiring
        FROM vehicles WHERE tenant_id = ${tenantId}
    `,

    db`
      SELECT COUNT(*)::int                                                AS items,
             COUNT(*) FILTER (WHERE current_stock <= reorder_level)::int  AS low_stock,
             COALESCE(SUM(current_stock * unit_cost), 0)::float           AS stock_value
        FROM inventory_items WHERE tenant_id = ${tenantId} AND is_active = TRUE
    `,

    db`
      SELECT COUNT(*) FILTER (WHERE status = 'open')::int                        AS open_deals,
             COALESCE(SUM(value) FILTER (WHERE status = 'open'), 0)::float        AS open_value,
             COALESCE(SUM(value) FILTER (WHERE status = 'won'
               AND closed_at >= date_trunc('month', CURRENT_DATE)), 0)::float     AS won_this_month
        FROM deals WHERE tenant_id = ${tenantId}
    `,

    db`
      SELECT COALESCE(SUM(total_amount - amount_paid), 0)::float            AS outstanding,
             COUNT(*) FILTER (WHERE status <> 'paid' AND status <> 'void'
                                AND due_date < CURRENT_DATE)::int           AS overdue
        FROM invoices WHERE tenant_id = ${tenantId} AND status NOT IN ('draft','void')
    `,

    db`
      SELECT COALESCE(SUM(total_amount - amount_paid), 0)::float            AS outstanding,
             COUNT(*) FILTER (WHERE status <> 'paid' AND status <> 'void'
                                AND due_date < CURRENT_DATE)::int           AS overdue
        FROM bills WHERE tenant_id = ${tenantId} AND status NOT IN ('draft','void')
    `,

    db`
      SELECT COUNT(*) FILTER (WHERE status = 'pending')::int               AS pending,
             COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0)::float AS pending_amount
        FROM expense_claims WHERE tenant_id = ${tenantId}
    `,

    db`
      SELECT COUNT(*)::int AS c FROM leave_requests
       WHERE tenant_id = ${tenantId} AND status = 'pending'
    `,

    db`
      SELECT COUNT(*)::int AS c,
             COALESCE(SUM(total_amount), 0)::float AS amount
        FROM purchase_orders
       WHERE tenant_id = ${tenantId} AND status = 'pending'
    `,

    // Devices that reported in the last 15 minutes — "who is live on the map".
    db`
      SELECT COUNT(DISTINCT user_id)::int AS c
        FROM location_logs
       WHERE tenant_id = ${tenantId} AND log_timestamp > now() - INTERVAL '15 minutes'
    `,

    db`
      SELECT a.id, a.action, a.summary, a.created_at, u.full_name
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.user_id
       WHERE a.tenant_id = ${tenantId}
       ORDER BY a.created_at DESC
       LIMIT 8
    `,

    // Six months of money in versus money out, from the payments ledger.
    db`
      SELECT to_char(m.month, 'Mon') AS label,
             COALESCE(SUM(p.amount) FILTER (WHERE p.direction = 'in'), 0)::float  AS inflow,
             COALESCE(SUM(p.amount) FILTER (WHERE p.direction = 'out'), 0)::float AS outflow
        FROM generate_series(date_trunc('month', CURRENT_DATE) - INTERVAL '5 months',
                             date_trunc('month', CURRENT_DATE), '1 month') AS m(month)
        LEFT JOIN payments p
               ON date_trunc('month', p.paid_on) = m.month AND p.tenant_id = ${tenantId}
       GROUP BY m.month
       ORDER BY m.month
    `,
  ]);

  const approvals = myPendingApprovals[0] as { leave_count: number; po_count: number };

  return {
    attendance,
    trend: trend as { label: string; value: number }[],
    myApprovals: approvals.leave_count + approvals.po_count,
    myApprovalBreakdown: approvals,
    myTasks: myTasks as unknown as {
      id: string;
      title: string;
      priority: string;
      status: string;
      due_date: string | null;
    }[],
    fleet: fleet[0] as {
      total: number;
      in_use: number;
      maintenance: number;
      available: number;
      docs_expiring: number;
    },
    inventory: inventory[0] as { items: number; low_stock: number; stock_value: number },
    pipeline: pipeline[0] as {
      open_deals: number;
      open_value: number;
      won_this_month: number;
    },
    receivables: receivables[0] as { outstanding: number; overdue: number },
    payables: payables[0] as { outstanding: number; overdue: number },
    expenses: expenses[0] as { pending: number; pending_amount: number },
    leavePending: (leavePending[0] as { c: number }).c,
    poPending: poPending[0] as { c: number; amount: number },
    fieldActive: (fieldActive[0] as { c: number }).c,
    activity: activity as unknown as {
      id: string;
      action: string;
      summary: string | null;
      created_at: string;
      full_name: string | null;
    }[],
    monthlyCash: monthlyCash as unknown as {
      label: string;
      inflow: number;
      outflow: number;
    }[],
  };
}
