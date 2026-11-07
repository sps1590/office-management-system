import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { importEmployeesAction, importLeaveAllotmentAction } from "@/lib/actions/import";
import { addUser, createTestTenant, signInAs, type TestTenant } from "../helpers/world";

/*
   Bulk import, against a real database.

   The risky parts are not the happy path. They are: a block of employee codes
   handed out without colliding with the admin's EMP-00001; a line manager
   named three rows below the person reporting to them; a bad row that must
   not take the good rows down with it; and -- the one most easily got wrong --
   a blank leave cell, which means "leave this category alone" and emphatically
   not "set it to zero".
*/

/** Builds the multipart payload the action reads, with a real File. */
function upload(csv: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("file", new File([csv], "import.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

describe("importing employees", () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await createTestTenant({ companyName: "Import Co" });
  });
  afterAll(async () => {
    await tenant.drop();
  });

  it("creates accounts whose temporary passwords actually work", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await importEmployeesAction(
      null,
      upload(
        "full_name*,email*,designation\n" +
          "Rahim Uddin,rahim@import.invalid,Officer\n" +
          "Karim Ali,karim@import.invalid,Driver\n"
      )
    );

    expect(state?.error).toBeUndefined();
    expect(state?.created).toBe(2);
    expect(state?.credentials).toHaveLength(2);

    const db = await getDb();
    for (const cred of state?.credentials ?? []) {
      const rows = await db`
        SELECT password_hash FROM users
         WHERE LOWER(email) = ${cred.email} AND tenant_id = ${tenant.tenantId}
      `;
      // The real bcrypt check the login path runs, not a string comparison.
      expect(verifyPassword(rows[0] as { password_hash: string }, cred.password)).toBe(true);
    }
  });

  it("gives every imported employee a distinct code, clear of the admin's", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    await importEmployeesAction(
      null,
      upload(
        "full_name*,email*\n" +
          "Code One,c1@import.invalid\n" +
          "Code Two,c2@import.invalid\n" +
          "Code Three,c3@import.invalid\n"
      )
    );

    const db = await getDb();
    const rows = await db`
      SELECT employee_code FROM users WHERE tenant_id = ${tenant.tenantId}
    `;
    const codes = (rows as unknown as { employee_code: string | null }[])
      .map((r) => r.employee_code)
      .filter(Boolean);
    // Provisioning gives the registering admin EMP-00001; a block drawn for
    // the import must not hand it out a second time.
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.filter((c) => c === "EMP-00001")).toHaveLength(1);
  });

  it("links a line manager who appears further down the same file", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await importEmployeesAction(
      null,
      upload(
        "full_name*,email*,line_manager_email\n" +
          "Junior Person,junior@import.invalid,boss@import.invalid\n" +
          "Boss Person,boss@import.invalid,\n"
      )
    );
    expect(state?.created).toBe(2);

    const db = await getDb();
    const rows = await db`
      SELECT m.email AS manager
        FROM users u JOIN users m ON m.id = u.line_manager_id
       WHERE LOWER(u.email) = 'junior@import.invalid' AND u.tenant_id = ${tenant.tenantId}
    `;
    expect((rows[0] as { manager: string } | undefined)?.manager).toBe("boss@import.invalid");
  });

  it("writes the good rows and reports the bad ones by line number", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await importEmployeesAction(
      null,
      upload(
        "full_name*,email*\n" +
          "Good One,good1@import.invalid\n" +
          "Bad Row,not-an-email\n" +
          "Good Two,good2@import.invalid\n"
      )
    );

    // An all-or-nothing import makes somebody bisect their own spreadsheet.
    expect(state?.created).toBe(2);
    expect(state?.problems).toHaveLength(1);
    expect(state?.problems?.[0].row).toBe(3);
  });

  it("refuses an email that already exists, and one repeated inside the file", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await importEmployeesAction(
      null,
      upload(
        "full_name*,email*\n" +
          "Repeat A,dup@import.invalid\n" +
          "Repeat B,dup@import.invalid\n"
      )
    );
    expect(state?.created).toBe(1);
    expect(state?.problems?.[0].message).toMatch(/appears twice/i);

    const again = await importEmployeesAction(
      null,
      upload("full_name*,email*\nRepeat C,dup@import.invalid\n")
    );
    expect(again?.created).toBe(0);
    expect(again?.error).toMatch(/Nothing could be imported/i);
    expect(again?.problems?.[0].message).toMatch(/already has an account/i);
  });

  it("refuses an unknown department unless asked to create it", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const refused = await importEmployeesAction(
      null,
      upload("full_name*,email*,department\nDept One,d1@import.invalid,Logistics\n")
    );
    expect(refused?.problems?.[0].message).toMatch(/No department called "Logistics"/);

    const allowed = await importEmployeesAction(
      null,
      upload("full_name*,email*,department\nDept One,d1@import.invalid,Logistics\n"),
    );
    expect(allowed?.problems).toHaveLength(1);

    const withFlag = await importEmployeesAction(
      null,
      upload(
        "full_name*,email*,department\nDept Two,d2@import.invalid,Logistics\n",
        { createMissing: "on" }
      )
    );
    expect(withFlag?.created).toBe(1);

    const db = await getDb();
    const made = await db`
      SELECT d.name FROM users u JOIN departments d ON d.id = u.department_id
       WHERE LOWER(u.email) = 'd2@import.invalid' AND u.tenant_id = ${tenant.tenantId}
    `;
    expect((made[0] as { name: string }).name).toBe("Logistics");
  });

  it("refuses to import for anybody without the directory permission", async () => {
    const plain = await addUser(tenant.tenantId, { roleKey: "employee" });
    await signInAs(plain, tenant.tenantId);
    await expect(
      importEmployeesAction(null, upload("full_name*,email*\nX,x@import.invalid\n"))
    ).rejects.toThrow();
  });

  it("cannot put an imported employee in another company's department", async () => {
    const other = await createTestTenant({ companyName: "Elsewhere Co" });
    const db = await getDb();
    const theirs = await db`
      INSERT INTO departments (tenant_id, name) VALUES (${other.tenantId}, 'Secret Dept')
      RETURNING id
    `;
    expect(theirs).toHaveLength(1);

    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await importEmployeesAction(
      null,
      upload("full_name*,email*,department\nCross Tenant,cross@import.invalid,Secret Dept\n")
    );
    // The name resolves only against this company's departments, so it reads
    // as a typo rather than reaching across the boundary.
    expect(state?.problems?.[0].message).toMatch(/No department called "Secret Dept"/);
    await other.drop();
  });
});

describe("importing the annual leave allotment", () => {
  let tenant: TestTenant;
  let staffEmail: string;

  beforeAll(async () => {
    tenant = await createTestTenant({ companyName: "Allotment Co" });
    const id = await addUser(tenant.tenantId, { roleKey: "employee", name: "Leave Taker" });
    const db = await getDb();
    const rows = await db`SELECT email FROM users WHERE id = ${id}`;
    staffEmail = (rows[0] as { email: string }).email;
  });
  afterAll(async () => {
    await tenant.drop();
  });

  const entitledFor = async (type: string) => {
    const db = await getDb();
    const rows = await db`
      SELECT lb.entitled::float AS entitled
        FROM leave_balances lb
        JOIN leave_types lt ON lt.id = lb.leave_type_id
        JOIN users u ON u.id = lb.user_id
       WHERE lb.tenant_id = ${tenant.tenantId} AND lb.year = 2026
         AND lt.name = ${type} AND LOWER(u.email) = ${staffEmail.toLowerCase()}
    `;
    return (rows[0] as { entitled: number } | undefined)?.entitled ?? null;
  };

  it("sets the entitlement named in each column", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await importLeaveAllotmentAction(
      null,
      upload(
        `email,Annual leave,Sick leave\n${staffEmail},18,7\n`,
        { year: "2026" }
      )
    );
    expect(state?.error).toBeUndefined();
    expect(await entitledFor("Annual leave")).toBe(18);
    expect(await entitledFor("Sick leave")).toBe(7);
  });

  it("treats a blank cell as 'leave it alone', not as zero", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    await importLeaveAllotmentAction(
      null,
      upload(`email,Annual leave,Sick leave\n${staffEmail},20,\n`, { year: "2026" })
    );
    expect(await entitledFor("Annual leave")).toBe(20);
    // Still 7 from the previous import. Reading blank as zero would silently
    // strip somebody's whole sick-leave entitlement.
    expect(await entitledFor("Sick leave")).toBe(7);
  });

  it("accepts an explicit zero as an instruction", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    await importLeaveAllotmentAction(
      null,
      upload(`email,Sick leave\n${staffEmail},0\n`, { year: "2026" })
    );
    expect(await entitledFor("Sick leave")).toBe(0);
  });

  it("overwrites on re-import rather than duplicating the row", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    await importLeaveAllotmentAction(
      null,
      upload(`email,Annual leave\n${staffEmail},12\n`, { year: "2026" })
    );
    const db = await getDb();
    const rows = await db`
      SELECT COUNT(*)::int AS n
        FROM leave_balances lb
        JOIN leave_types lt ON lt.id = lb.leave_type_id
       WHERE lb.tenant_id = ${tenant.tenantId} AND lt.name = 'Annual leave' AND lb.year = 2026
    `;
    expect((rows[0] as { n: number }).n).toBe(1);
    expect(await entitledFor("Annual leave")).toBe(12);
  });

  it("never rewrites how much leave somebody has already taken", async () => {
    const db = await getDb();
    await db`
      UPDATE leave_balances SET used = 4
       WHERE tenant_id = ${tenant.tenantId} AND year = 2026
    `;
    await signInAs(tenant.adminId, tenant.tenantId);
    await importLeaveAllotmentAction(
      null,
      upload(`email,Annual leave\n${staffEmail},25\n`, { year: "2026" })
    );
    const rows = await db`
      SELECT DISTINCT used::float AS used FROM leave_balances
       WHERE tenant_id = ${tenant.tenantId} AND year = 2026
    `;
    // `used` is derived from approved requests; a spreadsheet must not be
    // able to reach it.
    expect((rows as unknown as { used: number }[]).every((r) => r.used === 4)).toBe(true);
  });

  it("reports a row whose employee it cannot find", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await importLeaveAllotmentAction(
      null,
      upload("email,Annual leave\nnobody@nowhere.invalid,10\n", { year: "2026" })
    );
    expect(state?.problems?.[0].message).toMatch(/No employee matches/);
  });

  it("cannot set an allotment for somebody in another company", async () => {
    const other = await createTestTenant({ companyName: "Not Yours Co" });
    const strangerId = await addUser(other.tenantId, { roleKey: "employee" });
    const db = await getDb();
    const rows = await db`SELECT email FROM users WHERE id = ${strangerId}`;
    const strangerEmail = (rows[0] as { email: string }).email;

    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await importLeaveAllotmentAction(
      null,
      upload(`email,Annual leave\n${strangerEmail},99\n`, { year: "2026" })
    );
    expect(state?.problems?.[0].message).toMatch(/No employee matches/);

    const leaked = await db`
      SELECT COUNT(*)::int AS n FROM leave_balances WHERE user_id = ${strangerId}
    `;
    expect((leaked[0] as { n: number }).n).toBe(0);
    await other.drop();
  });
});
