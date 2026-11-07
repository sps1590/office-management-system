import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { requestLeaveAction, decideLeaveAction } from "@/lib/actions/leave";
import {
  decidePurchaseOrderAction,
  submitPurchaseOrderAction,
} from "@/lib/actions/procurement";
import { addUser, createTestTenant, form, signInAs, type TestTenant } from "../helpers/world";

/*
   Any approval chain has to satisfy both halves of the rule or it dead-ends,
   and on 2026-11-05 two bugs of exactly that shape were fixed:

     1. Nobody may decide a request they raised.
     2. *Because of that*, resolving an approver must SKIP a stage that lands
        on the requester and fall back to a company admin other than them.

   Enforcing only (1) is the bug: the record is parked in `pending` with an
   approver who is refused the moment they click. That is what happened to
   every purchase order raised by the procurement manager, who both raises
   orders and holds tier 1 of the default chain -- and to leave requested by
   whoever the chain resolved to.

   And when the company genuinely has one active user, there is nobody to ask.
   The purchase-order path releases the record and writes an audit row saying
   so, rather than leaving it unactionable forever.
*/
describe("the approval chain", () => {
  const tenants: TestTenant[] = [];

  /** A tenant plus a vendor and a draft order of the given value. */
  async function draftOrder(
    tenant: TestTenant,
    requestedBy: string,
    total: number
  ): Promise<string> {
    const db = await getDb();
    const vendor = await db`
      INSERT INTO vendors (tenant_id, company_name)
      VALUES (${tenant.tenantId}, 'Chain Test Vendor') RETURNING id
    `;
    const rows = await db`
      INSERT INTO purchase_orders (tenant_id, po_number, vendor_id, requested_by,
                                   order_date, subtotal, total_amount, status,
                                   current_tier, total_tiers)
      VALUES (${tenant.tenantId}, ${`PO-${Math.random().toString(36).slice(2, 8)}`},
              ${(vendor[0] as { id: string }).id}, ${requestedBy}, '2026-11-01',
              ${total}, ${total}, 'draft', 1, 1)
      RETURNING id
    `;
    return (rows[0] as { id: string }).id;
  }

  async function poStatus(tenantId: string, poId: string) {
    const db = await getDb();
    const rows = await db`
      SELECT status, current_tier, total_tiers FROM purchase_orders
       WHERE id = ${poId} AND tenant_id = ${tenantId}
    `;
    return rows[0] as { status: string; current_tier: number; total_tiers: number };
  }

  async function approvers(tenantId: string, poId: string) {
    const db = await getDb();
    const rows = await db`
      SELECT tier, approver_id, approver_role FROM po_approvals
       WHERE tenant_id = ${tenantId} AND purchase_order_id = ${poId}
       ORDER BY tier
    `;
    return rows as unknown as { tier: number; approver_id: string; approver_role: string }[];
  }

  afterAll(async () => {
    await Promise.all(tenants.map((t) => t.drop()));
  });

  /* --- half one: nobody decides their own request ------------------------ */

  it("refuses to let somebody decide their own leave request", async () => {
    const tenant = await createTestTenant();
    tenants.push(tenant);
    // An HR manager holds the second stage of the default chain
    // ("line_manager,hr_manager") and can approve other people's leave.
    const hr = await addUser(tenant.tenantId, { roleKey: "hr_manager" });

    await signInAs(hr, tenant.tenantId);
    const raised = await requestLeaveAction(
      null,
      await leaveForm(tenant.tenantId, "2026-12-07", "2026-12-08")
    );
    expect(raised?.error, raised?.error).toBeUndefined();

    const db = await getDb();
    const requests = await db`
      SELECT id FROM leave_requests WHERE tenant_id = ${tenant.tenantId} AND user_id = ${hr}
    `;
    const requestId = (requests[0] as { id: string }).id;

    // Still signed in as the person who raised it, and they hold
    // leave.approve — the permission is not the point, the authorship is.
    const decided = await decideLeaveAction(
      null,
      form({ requestId, decision: "approved" })
    );
    expect(decided?.success).toBeUndefined();
    expect(decided?.error).toMatch(/cannot decide your own/i);

    const after = await db`
      SELECT status FROM leave_requests WHERE id = ${requestId} AND tenant_id = ${tenant.tenantId}
    `;
    expect((after[0] as { status: string }).status).toBe("pending");
  });

  it("refuses to let somebody approve an order they raised", async () => {
    const tenant = await createTestTenant();
    tenants.push(tenant);
    const procurement = await addUser(tenant.tenantId, { roleKey: "procurement_manager" });

    // Raised by the procurement manager; the chain therefore resolves tier 1
    // past them, onto the company admin.
    const poId = await draftOrder(tenant, procurement, 10_000);
    await signInAs(procurement, tenant.tenantId);
    const submitted = await submitPurchaseOrderAction(null, form({ poId }));
    expect(submitted?.error, submitted?.error).toBeUndefined();
    expect((await poStatus(tenant.tenantId, poId)).status).toBe("pending");

    // The requester holds procurement.approve, so they reach the decide path
    // and are refused on authorship alone.
    const decided = await decidePurchaseOrderAction(
      null,
      form({ poId, decision: "approved" })
    );
    expect(decided?.success).toBeUndefined();
    expect(decided?.error).toMatch(/cannot approve an order you raised/i);
    expect((await poStatus(tenant.tenantId, poId)).status).toBe("pending");
  });

  /* --- half two: resolution skips the requester -------------------------- */

  it("resolves an order's tier past the requester onto another approver", async () => {
    const tenant = await createTestTenant();
    tenants.push(tenant);
    // The procurement manager holds tier 1 of the default chain and is also
    // the one raising the order. This is the common case that used to park.
    const procurement = await addUser(tenant.tenantId, { roleKey: "procurement_manager" });

    const poId = await draftOrder(tenant, procurement, 10_000);
    await signInAs(procurement, tenant.tenantId);
    await submitPurchaseOrderAction(null, form({ poId }));

    const chain = await approvers(tenant.tenantId, poId);
    expect(chain.length).toBeGreaterThan(0);
    // Not one tier may name the requester: a tier that did would be refused
    // at the point of clicking, which is the dead end.
    expect(chain.map((t) => t.approver_id)).not.toContain(procurement);
    // It fell back to the company admin, who is somebody else.
    expect(chain[0].approver_id).toBe(tenant.adminId);
    expect(chain[0].approver_role).toBe("company_admin");

    // And that approver really can decide it.
    await signInAs(tenant.adminId, tenant.tenantId);
    const decided = await decidePurchaseOrderAction(
      null,
      form({ poId, decision: "approved" })
    );
    expect(decided?.error, decided?.error).toBeUndefined();
    expect((await poStatus(tenant.tenantId, poId)).status).toBe("approved");
  });

  it("resolves a leave stage past the requester onto someone who can act", async () => {
    const tenant = await createTestTenant();
    tenants.push(tenant);
    // The HR manager raising leave is the person the "hr_manager" stage would
    // resolve to, and they are their own line manager's absence of one.
    const hr = await addUser(tenant.tenantId, { roleKey: "hr_manager" });

    await signInAs(hr, tenant.tenantId);
    await requestLeaveAction(
      null,
      await leaveForm(tenant.tenantId, "2026-12-14", "2026-12-15")
    );

    const db = await getDb();
    const stages = await db`
      SELECT la.stage, la.approver_id, la.approver_role
        FROM leave_approvals la
        JOIN leave_requests lr ON lr.id = la.leave_request_id
       WHERE la.tenant_id = ${tenant.tenantId} AND lr.user_id = ${hr}
       ORDER BY la.stage
    `;
    const chain = stages as unknown as { approver_id: string; approver_role: string }[];

    expect(chain.length).toBeGreaterThan(0);
    expect(chain.map((s) => s.approver_id)).not.toContain(hr);
    expect(chain[0].approver_id).toBe(tenant.adminId);

    // The admin can then actually decide it, which is the whole point of the
    // skip: a chain nobody can act on is the same as no chain.
    const requests = await db`
      SELECT id FROM leave_requests WHERE tenant_id = ${tenant.tenantId} AND user_id = ${hr}
    `;
    await signInAs(tenant.adminId, tenant.tenantId);
    const decided = await decideLeaveAction(
      null,
      form({ requestId: (requests[0] as { id: string }).id, decision: "approved" })
    );
    expect(decided?.error, decided?.error).toBeUndefined();
    expect(decided?.success).toMatch(/Approved/);
  });

  it("skips a stage whose role nobody holds rather than parking on it", async () => {
    const tenant = await createTestTenant();
    tenants.push(tenant);
    // A plain employee with no line manager, in a company with no HR manager:
    // both default stages resolve to nobody.
    const employee = await addUser(tenant.tenantId, { roleKey: "employee" });

    await signInAs(employee, tenant.tenantId);
    const raised = await requestLeaveAction(
      null,
      await leaveForm(tenant.tenantId, "2026-12-21", "2026-12-22")
    );
    expect(raised?.error, raised?.error).toBeUndefined();

    const db = await getDb();
    const stages = await db`
      SELECT la.approver_id, la.approver_role, lr.total_stages
        FROM leave_approvals la
        JOIN leave_requests lr ON lr.id = la.leave_request_id
       WHERE la.tenant_id = ${tenant.tenantId} AND lr.user_id = ${employee}
    `;
    const chain = stages as unknown as {
      approver_id: string;
      approver_role: string;
      total_stages: number;
    }[];

    // One workable stage, on the company admin — not two unactionable ones.
    expect(chain).toHaveLength(1);
    expect(chain[0].approver_id).toBe(tenant.adminId);
    expect(chain[0].approver_role).toBe("company_admin");
    expect(chain[0].total_stages).toBe(1);
  });

  it("honours a line manager when the employee has one", async () => {
    const tenant = await createTestTenant();
    tenants.push(tenant);
    // The skip must not have become "always the company admin": a real line
    // manager still takes stage one.
    const manager = await addUser(tenant.tenantId, { roleKey: "hr_manager" });
    const employee = await addUser(tenant.tenantId, {
      roleKey: "employee",
      lineManagerId: manager,
    });

    await signInAs(employee, tenant.tenantId);
    await requestLeaveAction(
      null,
      await leaveForm(tenant.tenantId, "2026-12-28", "2026-12-29")
    );

    const db = await getDb();
    const stages = await db`
      SELECT la.stage, la.approver_id FROM leave_approvals la
        JOIN leave_requests lr ON lr.id = la.leave_request_id
       WHERE la.tenant_id = ${tenant.tenantId} AND lr.user_id = ${employee}
       ORDER BY la.stage
    `;
    const chain = stages as unknown as { stage: number; approver_id: string }[];
    expect(chain[0].approver_id).toBe(manager);
  });

  /* --- the single-active-user case --------------------------------------- */

  it("releases an order with an audit row when there is genuinely nobody to ask", async () => {
    const tenant = await createTestTenant();
    tenants.push(tenant);
    // A company on its first day: one active user, the admin who signed up.
    const db = await getDb();
    const users = await db`
      SELECT COUNT(*)::int AS n FROM users
       WHERE tenant_id = ${tenant.tenantId} AND status = 'active'
    `;
    expect((users[0] as { n: number }).n).toBe(1);

    const poId = await draftOrder(tenant, tenant.adminId, 10_000);
    await signInAs(tenant.adminId, tenant.tenantId);
    const submitted = await submitPurchaseOrderAction(null, form({ poId }));

    // Released rather than parked: there is no second user to approve it, and
    // an order stuck in `pending` forever is the worse answer.
    expect(submitted?.error, submitted?.error).toBeUndefined();
    expect(submitted?.success).toMatch(/only active user/i);
    expect((await poStatus(tenant.tenantId, poId)).status).toBe("approved");

    // And it is on the record as an unapproved release, not as an approval.
    const audits = await db`
      SELECT action, summary FROM audit_logs
       WHERE tenant_id = ${tenant.tenantId} AND entity_id = ${poId}
       ORDER BY created_at
    `;
    const actions = (audits as unknown as { action: string; summary: string }[]);
    expect(actions.map((a) => a.action)).toContain("po.auto_approved");
    expect(actions.find((a) => a.action === "po.auto_approved")?.summary).toMatch(
      /without approval/i
    );
  });

  it("stops releasing orders the moment a second user exists", async () => {
    const tenant = await createTestTenant();
    tenants.push(tenant);
    // Same company, one more person — who need not hold any approval role,
    // only be a second company admin the fallback can land on.
    const secondAdmin = await addUser(tenant.tenantId, { roleKey: "company_admin" });

    const poId = await draftOrder(tenant, tenant.adminId, 10_000);
    await signInAs(tenant.adminId, tenant.tenantId);
    const submitted = await submitPurchaseOrderAction(null, form({ poId }));

    expect(submitted?.success).toMatch(/approval tier/i);
    expect((await poStatus(tenant.tenantId, poId)).status).toBe("pending");

    const chain = await approvers(tenant.tenantId, poId);
    expect(chain).toHaveLength(1);
    expect(chain[0].approver_id).toBe(secondAdmin);

    const db = await getDb();
    const audits = await db`
      SELECT action FROM audit_logs
       WHERE tenant_id = ${tenant.tenantId} AND entity_id = ${poId}
    `;
    expect((audits as unknown as { action: string }[]).map((a) => a.action)).not.toContain(
      "po.auto_approved"
    );
  });

  it("refuses to release an order for a non-admin with no approver", async () => {
    const tenant = await createTestTenant();
    tenants.push(tenant);
    // Auto-release is only honest for a company admin, who could assign
    // themselves any role anyway. Anyone else is told to ask for the roles to
    // be set up, rather than quietly gaining an approval they do not have.
    const procurement = await addUser(tenant.tenantId, { roleKey: "procurement_manager" });
    const db = await getDb();
    // Take the only other active user out, leaving no admin to fall back to.
    await db`UPDATE users SET status = 'left'
              WHERE id = ${tenant.adminId} AND tenant_id = ${tenant.tenantId}`;

    const poId = await draftOrder(tenant, procurement, 10_000);
    await signInAs(procurement, tenant.tenantId);
    const submitted = await submitPurchaseOrderAction(null, form({ poId }));

    expect(submitted?.success).toBeUndefined();
    expect(submitted?.error).toMatch(/No approver could be found/i);
    expect((await poStatus(tenant.tenantId, poId)).status).toBe("draft");
  });
});

/** The leave form, with the tenant's own "annual" type. */
async function leaveForm(tenantId: string, start: string, end: string): Promise<FormData> {
  const db = await getDb();
  const rows = await db`
    SELECT id FROM leave_types WHERE tenant_id = ${tenantId} AND key = 'annual'
  `;
  return form({
    leaveTypeId: (rows[0] as { id: string }).id,
    startDate: start,
    endDate: end,
    reason: "Approval chain test",
  });
}
