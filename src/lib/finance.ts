import "server-only";
import { getDb } from "./db";

export type Invoice = {
  id: string;
  invoice_number: string;
  client_id: string | null;
  client_name: string | null;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  amount_paid: number;
  status: string;
  notes: string | null;
  line_count: number;
};

export type Bill = {
  id: string;
  bill_number: string;
  vendor_id: string | null;
  vendor_name: string | null;
  po_number: string | null;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  amount_paid: number;
  status: string;
  notes: string | null;
};

export type ExpenseClaim = {
  id: string;
  claim_number: string | null;
  user_id: string;
  user_name: string;
  category: string;
  amount: number;
  expense_date: string;
  description: string | null;
  status: string;
  approver_name: string | null;
  comments: string | null;
  decided_at: string | null;
  reimbursed_on: string | null;
  latitude: number | null;
  longitude: number | null;
};

export async function listInvoices(
  tenantId: string,
  filters: { status?: string; clientId?: string } = {}
): Promise<Invoice[]> {
  const db = await getDb();
  const rows = await db`
    SELECT i.id, i.invoice_number, i.client_id, i.issue_date, i.due_date,
           i.subtotal::float AS subtotal, i.tax_amount::float AS tax_amount,
           i.discount_amount::float AS discount_amount,
           i.total_amount::float AS total_amount, i.amount_paid::float AS amount_paid,
           i.status, i.notes,
           c.name AS client_name,
           (SELECT COUNT(*)::int FROM invoice_items ii WHERE ii.invoice_id = i.id) AS line_count
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
     WHERE i.tenant_id = ${tenantId}
       AND (${filters.status ?? null}::text IS NULL OR i.status = ${filters.status ?? null})
       AND (${filters.clientId ?? null}::uuid IS NULL OR i.client_id = ${filters.clientId ?? null}::uuid)
     ORDER BY i.issue_date DESC, i.invoice_number DESC
     LIMIT 200
  `;
  return rows as unknown as Invoice[];
}

export async function invoiceLines(tenantId: string, invoiceId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT description, quantity::float AS quantity, unit_price::float AS unit_price,
           line_total::float AS line_total
      FROM invoice_items
     WHERE tenant_id = ${tenantId} AND invoice_id = ${invoiceId}
     ORDER BY sort_order
  `;
  return rows as unknown as {
    description: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
}

export async function listBills(
  tenantId: string,
  filters: { status?: string } = {}
): Promise<Bill[]> {
  const db = await getDb();
  const rows = await db`
    SELECT b.id, b.bill_number, b.vendor_id, b.issue_date, b.due_date,
           b.subtotal::float AS subtotal, b.tax_amount::float AS tax_amount,
           b.total_amount::float AS total_amount, b.amount_paid::float AS amount_paid,
           b.status, b.notes,
           v.company_name AS vendor_name, po.po_number
      FROM bills b
      LEFT JOIN vendors v         ON v.id = b.vendor_id
      LEFT JOIN purchase_orders po ON po.id = b.purchase_order_id
     WHERE b.tenant_id = ${tenantId}
       AND (${filters.status ?? null}::text IS NULL OR b.status = ${filters.status ?? null})
     ORDER BY b.issue_date DESC
     LIMIT 200
  `;
  return rows as unknown as Bill[];
}

export async function listExpenseClaims(
  tenantId: string,
  filters: { status?: string; userId?: string } = {}
): Promise<ExpenseClaim[]> {
  const db = await getDb();
  const rows = await db`
    SELECT e.id, e.claim_number, e.user_id, e.category, e.amount::float AS amount,
           e.expense_date, e.description, e.status, e.comments, e.decided_at,
           e.reimbursed_on, e.latitude::float AS latitude, e.longitude::float AS longitude,
           u.full_name AS user_name, a.full_name AS approver_name
      FROM expense_claims e
      JOIN users u      ON u.id = e.user_id
      LEFT JOIN users a ON a.id = e.approver_id
     WHERE e.tenant_id = ${tenantId}
       AND (${filters.status ?? null}::text IS NULL OR e.status = ${filters.status ?? null})
       AND (${filters.userId ?? null}::uuid IS NULL OR e.user_id = ${filters.userId ?? null}::uuid)
     ORDER BY e.expense_date DESC, e.created_at DESC
     LIMIT 200
  `;
  return rows as unknown as ExpenseClaim[];
}

export async function financeStats(tenantId: string) {
  const db = await getDb();
  const [ar, ap, exp, cash] = await Promise.all([
    db`
      SELECT COALESCE(SUM(total_amount - amount_paid), 0)::float AS outstanding,
             COALESCE(SUM(total_amount - amount_paid) FILTER (WHERE due_date < CURRENT_DATE), 0)::float AS overdue,
             COUNT(*) FILTER (WHERE status NOT IN ('paid','void'))::int AS open_count
        FROM invoices WHERE tenant_id = ${tenantId} AND status NOT IN ('draft','void')
    `,
    db`
      SELECT COALESCE(SUM(total_amount - amount_paid), 0)::float AS outstanding,
             COALESCE(SUM(total_amount - amount_paid) FILTER (WHERE due_date < CURRENT_DATE), 0)::float AS overdue,
             COUNT(*) FILTER (WHERE status NOT IN ('paid','void'))::int AS open_count
        FROM bills WHERE tenant_id = ${tenantId} AND status NOT IN ('draft','void')
    `,
    db`
      SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
             COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0)::float AS pending_amount,
             COALESCE(SUM(amount) FILTER (WHERE status = 'reimbursed'
               AND expense_date >= date_trunc('year', CURRENT_DATE)), 0)::float AS reimbursed_ytd
        FROM expense_claims WHERE tenant_id = ${tenantId}
    `,
    db`
      SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'in'), 0)::float  AS inflow,
             COALESCE(SUM(amount) FILTER (WHERE direction = 'out'), 0)::float AS outflow
        FROM payments WHERE tenant_id = ${tenantId}
    `,
  ]);
  return {
    receivable: ar[0] as { outstanding: number; overdue: number; open_count: number },
    payable: ap[0] as { outstanding: number; overdue: number; open_count: number },
    expenses: exp[0] as { pending: number; pending_amount: number; reimbursed_ytd: number },
    cash: cash[0] as { inflow: number; outflow: number },
  };
}

export async function listPayments(tenantId: string, limit = 40) {
  const db = await getDb();
  const rows = await db`
    SELECT p.id, p.direction, p.amount::float AS amount, p.method, p.paid_on,
           p.reference, p.note,
           i.invoice_number, b.bill_number, u.full_name AS created_by_name
      FROM payments p
      LEFT JOIN invoices i ON i.id = p.invoice_id
      LEFT JOIN bills b    ON b.id = p.bill_id
      LEFT JOIN users u    ON u.id = p.created_by
     WHERE p.tenant_id = ${tenantId}
     ORDER BY p.paid_on DESC, p.created_at DESC
     LIMIT ${limit}
  `;
  return rows as unknown as {
    id: string;
    direction: string;
    amount: number;
    method: string;
    paid_on: string;
    reference: string | null;
    note: string | null;
    invoice_number: string | null;
    bill_number: string | null;
    created_by_name: string | null;
  }[];
}

/** Monthly inflow and outflow for the cash-flow chart. */
export async function cashFlowTrend(tenantId: string, months = 6) {
  const db = await getDb();
  const rows = await db`
    SELECT to_char(m.month, 'Mon') AS label,
           COALESCE(SUM(p.amount) FILTER (WHERE p.direction = 'in'), 0)::float  AS inflow,
           COALESCE(SUM(p.amount) FILTER (WHERE p.direction = 'out'), 0)::float AS outflow
      FROM generate_series(date_trunc('month', CURRENT_DATE) - make_interval(months => ${months - 1}),
                           date_trunc('month', CURRENT_DATE), '1 month') AS m(month)
      LEFT JOIN payments p
             ON date_trunc('month', p.paid_on) = m.month AND p.tenant_id = ${tenantId}
     GROUP BY m.month
     ORDER BY m.month
  `;
  return rows as unknown as { label: string; inflow: number; outflow: number }[];
}
