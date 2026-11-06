import "server-only";
import { getDb } from "./db";
import { TENANT_ROLE_TEMPLATES } from "./modules";
import { addDays, isoDate } from "./utils";

// Everything a brand-new company needs before its first login: its own
// editable copy of the role matrix, a chart of accounts the auto-posting code
// can resolve by key, leave types, a sales pipeline, and the tunable settings
// row. Without this a tenant would exist but every module would be empty of
// the reference data it depends on.

const DEFAULT_LEAVE_TYPES = [
  { key: "annual", name: "Annual leave", quota: 10, paid: true, color: "#4f46e5" },
  { key: "sick", name: "Sick leave", quota: 14, paid: true, color: "#dc2626" },
  { key: "casual", name: "Casual leave", quota: 10, paid: true, color: "#0891b2" },
  { key: "maternity", name: "Maternity leave", quota: 112, paid: true, color: "#db2777" },
  { key: "unpaid", name: "Unpaid leave", quota: 0, paid: false, color: "#6b7280" },
];

// `key` is the stable handle src/lib/ledger.ts resolves accounts by, so an
// account can be renamed or renumbered without breaking auto-posting.
const DEFAULT_ACCOUNTS = [
  { code: "1000", key: "cash", name: "Cash & Bank", type: "asset" },
  { code: "1100", key: "accounts_receivable", name: "Accounts Receivable", type: "asset" },
  { code: "1200", key: "inventory", name: "Inventory", type: "asset" },
  { code: "1500", key: "fixed_assets", name: "Fixed Assets", type: "asset" },
  { code: "2000", key: "accounts_payable", name: "Accounts Payable", type: "liability" },
  { code: "2100", key: "salaries_payable", name: "Salaries Payable", type: "liability" },
  { code: "3000", key: "equity", name: "Owner's Equity", type: "equity" },
  { code: "3900", key: "retained_earnings", name: "Retained Earnings", type: "equity" },
  { code: "4000", key: "sales_income", name: "Sales Revenue", type: "income" },
  { code: "4900", key: "other_income", name: "Other Income", type: "income" },
  { code: "5000", key: "operating_expenses", name: "Operating Expenses", type: "expense" },
  { code: "5100", key: "cogs", name: "Purchases / Cost of Goods", type: "expense" },
  { code: "5200", key: "fuel_expense", name: "Fuel & Transport", type: "expense" },
  { code: "5300", key: "maintenance_expense", name: "Repairs & Maintenance", type: "expense" },
  { code: "5900", key: "payroll_expense", name: "Payroll Expense", type: "expense" },
  { code: "5950", key: "reimbursement_expense", name: "Employee Reimbursements", type: "expense" },
  { code: "6000", key: "tax_expense", name: "Tax & Duties", type: "expense" },
];

const DEFAULT_STAGES = [
  { key: "new", name: "New lead", order: 1, probability: 10, won: false, lost: false, color: "#64748b" },
  { key: "qualified", name: "Qualified", order: 2, probability: 25, won: false, lost: false, color: "#0891b2" },
  { key: "proposal", name: "Proposal sent", order: 3, probability: 50, won: false, lost: false, color: "#4f46e5" },
  { key: "negotiation", name: "Negotiation", order: 4, probability: 75, won: false, lost: false, color: "#d97706" },
  { key: "won", name: "Won", order: 5, probability: 100, won: true, lost: false, color: "#16a34a" },
  { key: "lost", name: "Lost", order: 6, probability: 0, won: false, lost: true, color: "#dc2626" },
];

// Tier 1 handles everyday orders; larger ones additionally need finance, and
// the largest need the company admin. Editable per tenant afterwards.
const DEFAULT_PO_TIERS = [
  { amount: 0, role: "procurement_manager" },
  { amount: 50_000, role: "finance_manager" },
  { amount: 500_000, role: "company_admin" },
];

/**
 * Creates a tenant plus its first user (the company admin) and all reference
 * data. Returns the new ids.
 *
 * Not wrapped in a transaction: the Neon HTTP driver issues each statement as
 * its own request, and a multi-statement transaction would need the WebSocket
 * driver. That made this the slowest path in the app -- 45 statements, one
 * round trip each, ~230 ms apiece from a function in Washington to a database
 * in Singapore -- so it runs in four waves instead, each wave concurrent and
 * every repeated insert collapsed into one `unnest` statement.
 *
 * The waves also preserve what the old ordering gave us: a failure part-way
 * leaves a tenant that is merely missing some defaults, never an orphaned
 * user with no company or a company whose admin cannot sign in. So everything
 * the first login needs -- roles, a department, settings -- lands before the
 * user, and the reference data that can be re-seeded later lands after.
 */
export async function provisionTenant(input: {
  companyName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  passwordHash: string;
  phone?: string | null;
  country?: string | null;
  currency?: string;
  timezone?: string;
}): Promise<{ tenantId: string; userId: string }> {
  const db = await getDb();
  // The company's own first day, not the database's: signing up at 01:00 in
  // Dhaka must not record a joining date of yesterday.
  const zone = input.timezone ?? "Asia/Dhaka";
  const today = isoDate(zone);
  const inThirtyDays = addDays(today, 30);

  const tenantRows = await db`
    INSERT INTO tenants (company_name, slug, status, plan_key, currency, timezone, country, phone, email, trial_ends_on)
    VALUES (${input.companyName}, ${input.slug}, 'trial', 'business',
            ${input.currency ?? "BDT"}, ${zone},
            ${input.country ?? null}, ${input.phone ?? null}, ${input.adminEmail},
            ${inThirtyDays}::date)
    RETURNING id
  `;
  const tenantId = (tenantRows[0] as { id: string }).id;

  // Wave 2: everything the admin's first login depends on. Concurrent, so
  // the cost is one round trip rather than twelve.
  const [roleRows, deptRows] = await Promise.all([
    db`
      INSERT INTO roles (tenant_id, key, role_name, description, permissions_matrix,
                         is_system, sort_order)
      SELECT ${tenantId}, k, n, d, m, TRUE, o
        FROM unnest(${TENANT_ROLE_TEMPLATES.map((r) => r.key)}::text[],
                    ${TENANT_ROLE_TEMPLATES.map((r) => r.name)}::text[],
                    ${TENANT_ROLE_TEMPLATES.map((r) => r.description)}::text[],
                    ${TENANT_ROLE_TEMPLATES.map((r) => JSON.stringify(r.matrix))}::jsonb[],
                    ${TENANT_ROLE_TEMPLATES.map((r) => r.sort_order)}::int[])
             AS t(k, n, d, m, o)
      RETURNING id, key
    `,
    db`
      INSERT INTO departments (tenant_id, name, code)
      VALUES (${tenantId}, 'Management', 'MGT')
      RETURNING id
    `,
    db`
      INSERT INTO tenant_settings (tenant_id, po_approval_tiers)
      VALUES (${tenantId}, ${JSON.stringify(DEFAULT_PO_TIERS)}::jsonb)
      ON CONFLICT (tenant_id) DO NOTHING
    `,
    db`
      INSERT INTO tenant_subscriptions (tenant_id, plan_key, status, renews_on, amount)
      VALUES (${tenantId}, 'business', 'active', ${inThirtyDays}::date, 0)
    `,
  ]);

  const roleIds: Record<string, string> = {};
  for (const r of roleRows as unknown as { id: string; key: string }[]) {
    roleIds[r.key] = r.id;
  }
  const departmentId = (deptRows[0] as { id: string }).id;

  // Wave 3: the company admin, who needs a role and a department to exist.
  const userRows = await db`
    INSERT INTO users (tenant_id, role_id, department_id, full_name, email, phone,
                       password_hash, employee_code, designation, status)
    VALUES (${tenantId}, ${roleIds.company_admin}, ${departmentId}, ${input.adminName},
            ${input.adminEmail}, ${input.phone ?? null}, ${input.passwordHash},
            'EMP-00001', 'Managing Director', 'active')
    RETURNING id
  `;
  const userId = (userRows[0] as { id: string }).id;

  // Wave 4: the admin can already sign in, so anything that fails here leaves
  // a usable company missing a default someone can re-add by hand.
  await Promise.all([
    db`
      INSERT INTO employee_profiles (user_id, tenant_id, date_of_joining, employment_type)
      VALUES (${userId}, ${tenantId}, ${today}::date, 'permanent')
    `,
    db`UPDATE departments SET head_user_id = ${userId}
        WHERE id = ${departmentId} AND tenant_id = ${tenantId}`,
    db`INSERT INTO doc_sequences (tenant_id, kind, next_value)
        VALUES (${tenantId}, 'employee', 2)
        ON CONFLICT (tenant_id, kind) DO NOTHING`,
    db`
      INSERT INTO leave_types (tenant_id, key, name, annual_quota, is_paid, color, sort_order)
      SELECT ${tenantId}, k, n, q, p, c, o
        FROM unnest(${DEFAULT_LEAVE_TYPES.map((t) => t.key)}::text[],
                    ${DEFAULT_LEAVE_TYPES.map((t) => t.name)}::text[],
                    ${DEFAULT_LEAVE_TYPES.map((t) => t.quota)}::numeric[],
                    ${DEFAULT_LEAVE_TYPES.map((t) => t.paid)}::boolean[],
                    ${DEFAULT_LEAVE_TYPES.map((t) => t.color)}::text[],
                    ${DEFAULT_LEAVE_TYPES.map((_, i) => i + 1)}::int[])
             AS t(k, n, q, p, c, o)
      ON CONFLICT (tenant_id, key) DO NOTHING
    `,
    db`
      INSERT INTO accounts (tenant_id, code, key, name, type, sort_order)
      SELECT ${tenantId}, c, k, n, ty, o
        FROM unnest(${DEFAULT_ACCOUNTS.map((a) => a.code)}::text[],
                    ${DEFAULT_ACCOUNTS.map((a) => a.key)}::text[],
                    ${DEFAULT_ACCOUNTS.map((a) => a.name)}::text[],
                    ${DEFAULT_ACCOUNTS.map((a) => a.type)}::text[],
                    ${DEFAULT_ACCOUNTS.map((_, i) => i + 1)}::int[])
             AS t(c, k, n, ty, o)
      ON CONFLICT (tenant_id, code) DO NOTHING
    `,
    db`
      INSERT INTO pipeline_stages (tenant_id, key, name, sort_order, probability,
                                   is_won, is_lost, color)
      SELECT ${tenantId}, k, n, o, pr, w, l, c
        FROM unnest(${DEFAULT_STAGES.map((x) => x.key)}::text[],
                    ${DEFAULT_STAGES.map((x) => x.name)}::text[],
                    ${DEFAULT_STAGES.map((x) => x.order)}::int[],
                    ${DEFAULT_STAGES.map((x) => x.probability)}::numeric[],
                    ${DEFAULT_STAGES.map((x) => x.won)}::boolean[],
                    ${DEFAULT_STAGES.map((x) => x.lost)}::boolean[],
                    ${DEFAULT_STAGES.map((x) => x.color)}::text[])
             AS t(k, n, o, pr, w, l, c)
      ON CONFLICT (tenant_id, key) DO NOTHING
    `,
  ]);

  return { tenantId, userId };
}

/** Role id lookup used when inviting a user. */
export async function roleIdByKey(tenantId: string, key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db`
    SELECT id FROM roles WHERE tenant_id = ${tenantId} AND key = ${key}
  `;
  return (rows[0] as { id: string } | undefined)?.id ?? null;
}
