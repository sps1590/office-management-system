import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { addUser, createTestTenant, signInAs, signOut } from "./helpers/world";
import { assertThrowawayDatabase } from "./helpers/env";
import { expectRedirect } from "./stubs/next-navigation";

/*
   Proves the harness itself before anything is asserted through it. If
   `requireUser()` does not resolve a real session into a real user here, then
   every "the action refused" result in the rest of the suite could just be a
   broken stub.
*/
describe("the harness", () => {
  const tenants: { drop: () => Promise<void> }[] = [];
  afterAll(async () => {
    for (const t of tenants) await t.drop();
  });

  it("provisions a tenant through the product's own signup path", async () => {
    const tenant = await createTestTenant({ companyName: "Harness Ltd" });
    tenants.push(tenant);
    const db = await getDb();

    const [roles, accounts, leaveTypes, stages, settings, admin] = await Promise.all([
      db`SELECT COUNT(*)::int AS n FROM roles WHERE tenant_id = ${tenant.tenantId}`,
      db`SELECT COUNT(*)::int AS n FROM accounts WHERE tenant_id = ${tenant.tenantId}`,
      db`SELECT COUNT(*)::int AS n FROM leave_types WHERE tenant_id = ${tenant.tenantId}`,
      db`SELECT COUNT(*)::int AS n FROM pipeline_stages WHERE tenant_id = ${tenant.tenantId}`,
      db`SELECT COUNT(*)::int AS n FROM tenant_settings WHERE tenant_id = ${tenant.tenantId}`,
      db`SELECT employee_code FROM users WHERE id = ${tenant.adminId} AND tenant_id = ${tenant.tenantId}`,
    ]);

    expect((roles[0] as { n: number }).n).toBeGreaterThan(0);
    expect((accounts[0] as { n: number }).n).toBe(17);
    expect((leaveTypes[0] as { n: number }).n).toBe(5);
    expect((stages[0] as { n: number }).n).toBe(6);
    expect((settings[0] as { n: number }).n).toBe(1);
    expect((admin[0] as { employee_code: string }).employee_code).toBe("EMP-00001");
  });

  it("resolves a signed-in session into the real user, role and tenant", async () => {
    const tenant = await createTestTenant({ timezone: "America/Los_Angeles" });
    tenants.push(tenant);

    await signInAs(tenant.adminId, tenant.tenantId);
    const user = await requireUser();

    expect(user.id).toBe(tenant.adminId);
    expect(user.tenant_id).toBe(tenant.tenantId);
    expect(user.role_key).toBe("company_admin");
    // The tenant's zone, not the server's — every wall clock in the product
    // is computed from this.
    expect(user.tenant.timezone).toBe("America/Los_Angeles");
    expect(user.is_platform_admin).toBe(false);
    // A company admin bypasses the matrix entirely.
    expect(user.permissions.settings?.edit).toBe(true);
  });

  it("sends an anonymous caller to /login", async () => {
    signOut();
    await expectRedirect(requireUser(), "/login");
  });

  /*
     The interlock that keeps this suite off the live database. It refuses any
     database holding a tenant the suite did not create, and on the production
     branch that tenant is NMCP.

     Tested by making this database look like that one for a moment: a tenant
     whose slug is not the suite's. Pointing the test at production to watch
     it refuse would mean reading production, which is the thing being
     prevented.
  */
  it("refuses a database holding a tenant it did not create", async () => {
    const db = await getDb();
    const planted = await db`
      INSERT INTO tenants (company_name, slug, status, plan_key, currency, timezone)
      VALUES ('Not A Test Company', 'a-real-company', 'active', 'business', 'BDT', 'Asia/Dhaka')
      RETURNING id
      -- tenancy-ok: inserting the row the interlock is supposed to notice
    `;
    const plantedId = (planted[0] as { id: string }).id;
    try {
      await expect(assertThrowawayDatabase()).rejects.toThrow(/REFUSING TO RUN/);
      await expect(assertThrowawayDatabase()).rejects.toThrow(/Not A Test Company/);
    } finally {
      await db`DELETE FROM tenants WHERE id = ${plantedId}
               -- tenancy-ok: removing the planted row again`;
    }

    // And passes once the database holds only the suite's own tenants.
    await expect(assertThrowawayDatabase()).resolves.toBeUndefined();
  });

  it("gives a plain employee no settings permission", async () => {
    const tenant = await createTestTenant();
    tenants.push(tenant);
    const employeeId = await addUser(tenant.tenantId, { roleKey: "employee" });

    await signInAs(employeeId, tenant.tenantId);
    const user = await requireUser();

    expect(user.role_key).toBe("employee");
    expect(user.permissions.settings?.edit ?? false).toBe(false);
  });
});
