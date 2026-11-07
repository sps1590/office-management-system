import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { getEmployee, listEmployees } from "@/lib/employees";
import { listVendors, listPurchaseOrders, getPurchaseOrder } from "@/lib/procurement";
import { listClients, listDeals } from "@/lib/crm";
import { listInvoices } from "@/lib/finance";
import { listVehicles } from "@/lib/fleet";
import { listTasks } from "@/lib/workplace";
import { listGeofences, listDevices } from "@/lib/tracking";
import { listLeaveRequests } from "@/lib/leave";
import { enrolDevice } from "@/lib/telemetry";
import { deleteGeofenceAction, toggleGeofenceAction } from "@/lib/actions/tracking";
import { addUser, createTestTenant, form, signInAs, type TestTenant } from "../helpers/world";

/*
   The multi-tenant isolation boundary from CLAUDE.md: every query touching
   tenant data filters by a `tenant_id` taken from the session, never from
   anything the client sent. Getting it wrong leaks one company's data to
   another, which is the worst failure this product has available to it.

   `npm run check:tenancy` already proves statically that every tenant-scoped
   query *mentions* tenant_id. What it cannot prove is that the filter is on
   the right table, or joined the right way round, or not defeated by a LEFT
   JOIN. So: two companies, each with a row in every table that matters, and
   then every read run as the other one.

   Two shapes of attack are checked. A list read must not include the other
   company's rows even though they are right there in the same table. And a
   detail read or a write given the other company's row *id* -- a real id, as
   anyone who had ever seen one could supply -- must come back empty rather
   than obliging.
*/
describe("tenant isolation", () => {
  let a: TestTenant;
  let b: TestTenant;

  /** Everything tenant B owns, so a read as A can be checked against it. */
  const bOwns: Record<string, string> = {};

  /** Seeds one row per table, named after its owner so a leak is obvious. */
  async function seed(tenant: TestTenant, label: string): Promise<Record<string, string>> {
    const db = await getDb();
    const ids: Record<string, string> = {};
    const one = (rows: Record<string, unknown>[]) => (rows[0] as { id: string }).id;

    ids.user = await addUser(tenant.tenantId, {
      roleKey: "employee",
      name: `${label} Employee`,
    });

    ids.vendor = one(
      await db`INSERT INTO vendors (tenant_id, company_name)
               VALUES (${tenant.tenantId}, ${`${label} Vendor`}) RETURNING id`
    );
    ids.client = one(
      await db`INSERT INTO clients (tenant_id, name)
               VALUES (${tenant.tenantId}, ${`${label} Client`}) RETURNING id`
    );
    ids.deal = one(
      await db`INSERT INTO deals (tenant_id, client_id, title, value)
               VALUES (${tenant.tenantId}, ${ids.client}, ${`${label} Deal`}, 1000) RETURNING id`
    );
    ids.invoice = one(
      await db`INSERT INTO invoices (tenant_id, invoice_number, client_id, total_amount)
               VALUES (${tenant.tenantId}, ${`${label}-INV-1`}, ${ids.client}, 1000) RETURNING id`
    );
    ids.vehicle = one(
      await db`INSERT INTO vehicles (tenant_id, registration_number)
               VALUES (${tenant.tenantId}, ${`${label}-REG-1`}) RETURNING id`
    );
    ids.task = one(
      await db`INSERT INTO tasks (tenant_id, title)
               VALUES (${tenant.tenantId}, ${`${label} Task`}) RETURNING id`
    );
    ids.geofence = one(
      await db`INSERT INTO geofences (tenant_id, name, kind, shape, center_lat, center_lng,
                                      radius_meters, is_active)
               VALUES (${tenant.tenantId}, ${`${label} Fence`}, 'territory', 'circle',
                       23.81, 90.41, 500, TRUE) RETURNING id`
    );

    const leaveType = await db`
      SELECT id FROM leave_types WHERE tenant_id = ${tenant.tenantId} AND key = 'annual'
    `;
    ids.leaveRequest = one(
      await db`INSERT INTO leave_requests (tenant_id, user_id, leave_type_id, start_date,
                                           end_date, days, reason)
               VALUES (${tenant.tenantId}, ${ids.user},
                       ${(leaveType[0] as { id: string }).id},
                       '2026-12-01', '2026-12-02', 2, ${`${label} leave`}) RETURNING id`
    );

    ids.purchaseOrder = one(
      await db`INSERT INTO purchase_orders (tenant_id, po_number, vendor_id, requested_by,
                                            order_date, total_amount, status)
               VALUES (${tenant.tenantId}, ${`${label}-PO-1`}, ${ids.vendor},
                       ${tenant.adminId}, '2026-11-01', 5000, 'draft') RETURNING id`
    );

    await enrolDevice({
      tenantId: tenant.tenantId,
      userId: ids.user,
      deviceId: `${label}-device`,
      platform: "android",
      model: `${label} phone`,
    });

    return ids;
  }

  beforeAll(async () => {
    [a, b] = await Promise.all([
      createTestTenant({ companyName: "Alpha Ltd" }),
      createTestTenant({ companyName: "Bravo Ltd" }),
    ]);
    const [, bIds] = await Promise.all([seed(a, "ALPHA"), seed(b, "BRAVO")]);
    Object.assign(bOwns, bIds);
  });

  afterAll(async () => {
    await Promise.all([a.drop(), b.drop()]);
  });

  it("seeded both companies, so a leak has something to leak", async () => {
    const db = await getDb();
    const rows = await db`
      SELECT COUNT(*)::int AS n FROM vendors WHERE tenant_id = ANY(${[a.tenantId, b.tenantId]})
    `;
    expect((rows[0] as { n: number }).n).toBe(2);
  });

  /*
     One case per list read: run it as Alpha and assert nothing of Bravo's
     comes back. The marker is in the name of every seeded row, so a leak
     fails on the string rather than on a count that happens to match.
  */
  const listReads: [string, (tenantId: string) => Promise<unknown[]>][] = [
    ["employees", (t) => listEmployees(t)],
    ["vendors", (t) => listVendors(t)],
    ["clients", (t) => listClients(t)],
    ["deals", (t) => listDeals(t)],
    ["invoices", (t) => listInvoices(t)],
    ["vehicles", (t) => listVehicles(t)],
    ["tasks", (t) => listTasks(t)],
    ["geofences", (t) => listGeofences(t)],
    // listDevices buckets "seen today" by the tenant's own zone, so it takes
    // one — the tenants here are both Asia/Dhaka.
    ["devices", (t) => listDevices(t, "Asia/Dhaka")],
    ["leave requests", (t) => listLeaveRequests(t)],
    ["purchase orders", (t) => listPurchaseOrders(t)],
  ];

  for (const [name, read] of listReads) {
    it(`gives Alpha none of Bravo's ${name}`, async () => {
      const mine = await read(a.tenantId);
      const theirs = await read(b.tenantId);

      // Both companies have rows, so "nothing leaked" is not just "nothing
      // was returned".
      expect(mine.length, `Alpha should have at least one ${name}`).toBeGreaterThan(0);
      expect(theirs.length, `Bravo should have at least one ${name}`).toBeGreaterThan(0);

      const text = JSON.stringify(mine);
      expect(text).not.toContain("BRAVO");
      expect(text).not.toContain(b.tenantId);
      expect(text).not.toContain(b.slug);

      // And no row carries another tenant's id in a column that names one.
      for (const row of mine as Record<string, unknown>[]) {
        if ("tenant_id" in row) expect(row.tenant_id).toBe(a.tenantId);
      }
    });
  }

  it("gives Alpha nothing when asked for Bravo's employee by id", async () => {
    // A real id, of a real user, in the same table.
    expect(await getEmployee(b.tenantId, bOwns.user)).not.toBeNull();
    expect(await getEmployee(a.tenantId, bOwns.user)).toBeNull();
  });

  it("gives Alpha nothing when asked for Bravo's purchase order by id", async () => {
    const theirs = await getPurchaseOrder(b.tenantId, bOwns.purchaseOrder);
    expect(theirs).not.toBeNull();
    expect(theirs?.header.po_number).toContain("BRAVO");

    // Nothing at all, not an empty shell that still proves the id is real.
    expect(await getPurchaseOrder(a.tenantId, bOwns.purchaseOrder)).toBeNull();
  });

  it("refuses to let Alpha's admin delete Bravo's geofence", async () => {
    await signInAs(a.adminId, a.tenantId);
    const result = await deleteGeofenceAction(null, form({ geofenceId: bOwns.geofence }));

    // Not found, rather than "no permission" — Alpha cannot learn that the
    // row exists at all.
    expect(result?.success).toBeUndefined();
    expect(result?.error).toMatch(/not found/i);

    const db = await getDb();
    const still = await db`
      SELECT name FROM geofences WHERE id = ${bOwns.geofence} AND tenant_id = ${b.tenantId}
    `;
    expect(still).toHaveLength(1);
    expect((still[0] as { name: string }).name).toContain("BRAVO");
  });

  it("refuses to let Alpha's admin toggle Bravo's geofence", async () => {
    await signInAs(a.adminId, a.tenantId);
    const result = await toggleGeofenceAction(null, form({ geofenceId: bOwns.geofence }));
    expect(result?.error).toMatch(/not found/i);

    const db = await getDb();
    const still = await db`
      SELECT is_active FROM geofences WHERE id = ${bOwns.geofence} AND tenant_id = ${b.tenantId}
    `;
    expect((still[0] as { is_active: boolean }).is_active).toBe(true);
  });

  it("will not let a company admin reach the platform-wide views", async () => {
    // Super Admin comes only from PLATFORM_ADMIN_IDENTIFIERS, never from a
    // tenant's own role matrix — otherwise a company admin could grant
    // themselves sight of every tenant.
    const { requirePlatformAdmin } = await import("@/lib/permissions");
    const { expectRedirect } = await import("../stubs/next-navigation");

    await signInAs(a.adminId, a.tenantId);
    await expectRedirect(requirePlatformAdmin(), "/dashboard");
  });
});
