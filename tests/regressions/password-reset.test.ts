import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { generateTempPassword, verifyPassword } from "@/lib/auth";
import { resetUserPasswordAction } from "@/lib/actions/employees";
import { expectRedirect } from "../stubs/next-navigation";
import { addUser, createTestTenant, form, signInAs, type TestTenant } from "../helpers/world";

/*
   Gap: there was no way back into an account whose password was lost.

   `/me` can change a password but demands the current one, a reset link needs
   a mail provider the product does not have, and `/users` offered only role
   and status. So anybody who forgot their password was locked out of the
   company for good -- which happened to this project's own first admin on
   2026-11-07, and could only be undone by editing the database by hand.

   `resetUserPasswordAction` closes it for everyone except a sole company
   admin, who still needs the operator. The tests below pin the behaviour and,
   just as importantly, the two refusals: never on yourself, and never across
   a tenant boundary.
*/

/** The action hands the password back inside its success message, once. */
function passwordFrom(success: string | undefined): string {
  const match = /\): (\S+) /.exec(success ?? "");
  if (!match) throw new Error(`No password in the success message: ${success}`);
  return match[1];
}

describe("resetting a password", () => {
  let tenant: TestTenant;
  let other: TestTenant;
  let employeeId: string;

  beforeAll(async () => {
    tenant = await createTestTenant({ companyName: "Reset Co" });
    other = await createTestTenant({ companyName: "Other Co" });
    employeeId = await addUser(tenant.tenantId, { roleKey: "employee", name: "Locked Out" });
  });

  afterAll(async () => {
    await Promise.all([tenant.drop(), other.drop()]);
  });

  it("hands the admin a password that actually works", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await resetUserPasswordAction(null, form({ userId: employeeId }));

    expect(state?.error).toBeUndefined();
    const password = passwordFrom(state?.success);

    const db = await getDb();
    const rows = await db`
      SELECT password_hash FROM users
       WHERE id = ${employeeId} AND tenant_id = ${tenant.tenantId}
    `;
    const stored = rows[0] as { password_hash: string };
    // The real bcrypt check the login path runs, not a string comparison.
    expect(verifyPassword(stored, password)).toBe(true);
    expect(verifyPassword(stored, "the-old-one")).toBe(false);
  });

  it("signs the person out of every device", async () => {
    const db = await getDb();
    await signInAs(employeeId, tenant.tenantId);
    const before = await db`
      SELECT COUNT(*)::int AS n FROM sessions
       WHERE user_id = ${employeeId} AND tenant_id = ${tenant.tenantId}
    `;
    expect((before[0] as { n: number }).n).toBeGreaterThan(0);

    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await resetUserPasswordAction(null, form({ userId: employeeId }));
    expect(state?.success).toBeTruthy();

    const after = await db`
      SELECT COUNT(*)::int AS n FROM sessions
       WHERE user_id = ${employeeId} AND tenant_id = ${tenant.tenantId}
    `;
    // A password is reset because it was lost or because the account was
    // taken; in the second case a surviving cookie makes the reset pointless.
    expect((after[0] as { n: number }).n).toBe(0);
  });

  it("refuses an admin resetting their own password", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await resetUserPasswordAction(null, form({ userId: tenant.adminId }));

    expect(state?.success).toBeUndefined();
    expect(state?.error).toMatch(/cannot reset your own password/i);
  });

  it("leaves the admin's own hash untouched when it refuses", async () => {
    const db = await getDb();
    const before = await db`
      SELECT password_hash FROM users
       WHERE id = ${tenant.adminId} AND tenant_id = ${tenant.tenantId}
    `;
    await signInAs(tenant.adminId, tenant.tenantId);
    await resetUserPasswordAction(null, form({ userId: tenant.adminId }));
    const after = await db`
      SELECT password_hash FROM users
       WHERE id = ${tenant.adminId} AND tenant_id = ${tenant.tenantId}
    `;
    expect((after[0] as { password_hash: string }).password_hash).toBe(
      (before[0] as { password_hash: string }).password_hash
    );
  });

  it("refuses anybody who is not a company admin", async () => {
    const plain = await addUser(tenant.tenantId, { roleKey: "employee" });
    await signInAs(plain, tenant.tenantId);
    // requireCompanyAdmin sends them away rather than answering.
    await expectRedirect(
      resetUserPasswordAction(null, form({ userId: employeeId })),
      "/dashboard"
    );
  });

  it("refuses an HR manager too, however the matrix is configured", async () => {
    const hr = await addUser(tenant.tenantId, { roleKey: "hr_manager" });
    await signInAs(hr, tenant.tenantId);
    await expectRedirect(
      resetUserPasswordAction(null, form({ userId: employeeId })),
      "/dashboard"
    );
  });

  it("cannot reach a user in another company", async () => {
    const stranger = await addUser(other.tenantId, { roleKey: "employee" });
    const db = await getDb();
    const before = await db`
      SELECT password_hash FROM users
       WHERE id = ${stranger} AND tenant_id = ${other.tenantId}
    `;

    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await resetUserPasswordAction(null, form({ userId: stranger }));
    expect(state?.error).toMatch(/not found/i);

    const after = await db`
      SELECT password_hash FROM users
       WHERE id = ${stranger} AND tenant_id = ${other.tenantId}
    `;
    expect((after[0] as { password_hash: string }).password_hash).toBe(
      (before[0] as { password_hash: string }).password_hash
    );
  });

  it("writes an audit row naming the admin who did it", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    await resetUserPasswordAction(null, form({ userId: employeeId }));

    const db = await getDb();
    const rows = await db`
      SELECT user_id, entity_id, summary FROM audit_logs
       WHERE tenant_id = ${tenant.tenantId} AND action = 'user.password_reset'
       ORDER BY created_at DESC LIMIT 1
    `;
    const row = rows[0] as { user_id: string; entity_id: string; summary: string };
    expect(row.user_id).toBe(tenant.adminId);
    expect(row.entity_id).toBe(employeeId);
  });
});

describe("the generated temporary password", () => {
  it("satisfies the product's own password policy", () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateTempPassword();
      expect(pw.length).toBeGreaterThanOrEqual(8);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[0-9]/);
    }
  });

  it("leaves out the characters people misread aloud", () => {
    // These get handed over by voice or on paper, so O/0 and I/l/1 are out.
    for (let i = 0; i < 50; i++) {
      expect(generateTempPassword()).not.toMatch(/[O0Il1]/);
    }
  });

  it("does not put the guaranteed three in fixed positions", () => {
    // Without the shuffle every password would be lower, upper, digit, ...
    const shaped = Array.from({ length: 60 }, () => generateTempPassword()).filter((pw) =>
      /^[a-z][A-Z][0-9]/.test(pw)
    );
    expect(shaped.length).toBeLessThan(10);
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateTempPassword()));
    expect(seen.size).toBe(200);
  });
});
