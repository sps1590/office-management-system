import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { stillInUse } from "@/lib/guards";
import {
  deleteDepartmentAction,
  resetUserPasswordAction,
  setUserStatusAction,
  updateDepartmentAction,
} from "@/lib/actions/employees";
import { deleteLeaveTypeAction, saveHolidayAction, deleteHolidayAction } from "@/lib/actions/leave";
import { deleteClientAction, updateClientAction } from "@/lib/actions/crm";
import { addUser, createTestTenant, form, signInAs, type TestTenant } from "../helpers/world";

/*
   What an administrator may change, and what the product refuses to let
   anybody destroy.

   Two rules are being pinned. The first is the one the company asked for:
   an employee record is never deleted — there is no action that does it,
   and marking somebody inactive leaves every row that references them
   exactly where it was.

   The second is the rule behind every delete that does exist. Almost every
   foreign key in this schema is ON DELETE CASCADE, which means the database
   will happily erase a client's deals or a vehicle's trip history on the
   way to erasing the parent. So each delete counts its dependents first and
   refuses while any remain. A test that only checked the happy path would
   pass against a delete that quietly took a year of history with it.
*/

describe("the in-use refusal", () => {
  it("counts and pluralises what is in the way", () => {
    expect(stillInUse([{ n: 0, label: "deal" }])).toBeNull();
    expect(stillInUse([{ n: 1, label: "deal" }])).toContain("1 deal ");
    expect(stillInUse([{ n: 3, label: "deal" }])).toContain("3 deals");
    const both = stillInUse([
      { n: 2, label: "invoice" },
      { n: 1, label: "field visit" },
    ]);
    expect(both).toContain("2 invoices");
    expect(both).toContain("1 field visit");
  });

  it("carries the way out, so a refusal is not a dead end", () => {
    expect(stillInUse([{ n: 1, label: "deal" }], "Mark it churned instead.")).toContain(
      "Mark it churned instead."
    );
  });
});

describe("an employee is never deleted", () => {
  let tenant: TestTenant;
  let admin: string;
  let victim: string;

  beforeAll(async () => {
    tenant = await createTestTenant({ companyName: "Lifecycle Co" });
    admin = tenant.adminId;
    victim = await addUser(tenant.tenantId, { roleKey: "employee", name: "Departing Person" });
    await signInAs(admin, tenant.tenantId);
  });
  afterAll(async () => {
    await tenant.drop();
  });

  it("has no action that removes one", async () => {
    const employees = await import("@/lib/actions/employees");
    const removers = Object.keys(employees).filter((k) => /^delete(User|Employee)/.test(k));
    // Attendance, payslips, approvals and the audit trail all reference the
    // user row, and a company's duty to keep employment records outlives the
    // employment. Inactive is the only exit.
    expect(removers).toEqual([]);
  });

  it("keeps the record, and everything hanging off it, when marked inactive", async () => {
    const db = await getDb();
    await db`
      INSERT INTO attendance_records (tenant_id, user_id, work_date, worked_minutes, status)
      VALUES (${tenant.tenantId}, ${victim}, '2026-10-05', 480, 'present')
    `;
    await signInAs(admin, tenant.tenantId);
    const state = await setUserStatusAction(null, form({ userId: victim, status: "left" }));
    expect(state?.success).toBeTruthy();

    const [rows, attendance] = await Promise.all([
      db`SELECT status, full_name FROM users WHERE id = ${victim} AND tenant_id = ${tenant.tenantId}`,
      db`SELECT COUNT(*)::int AS n FROM attendance_records WHERE tenant_id = ${tenant.tenantId} AND user_id = ${victim}`,
    ]);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { status: string }).status).toBe("left");
    expect((attendance[0] as { n: number }).n).toBe(1);
  });

  it("can be undone, which deletion could not be", async () => {
    await signInAs(admin, tenant.tenantId);
    await setUserStatusAction(null, form({ userId: victim, status: "active" }));
    const db = await getDb();
    const rows = await db`
      SELECT status FROM users WHERE id = ${victim} AND tenant_id = ${tenant.tenantId}
    `;
    expect((rows[0] as { status: string }).status).toBe("active");
  });

  it("ends the person's sessions the moment they stop being active", async () => {
    const db = await getDb();
    await signInAs(victim, tenant.tenantId);
    await signInAs(admin, tenant.tenantId);
    await setUserStatusAction(null, form({ userId: victim, status: "suspended" }));
    const live = await db`
      SELECT COUNT(*)::int AS n FROM sessions
       WHERE tenant_id = ${tenant.tenantId} AND user_id = ${victim}
    `;
    expect((live[0] as { n: number }).n).toBe(0);
    await setUserStatusAction(null, form({ userId: victim, status: "active" }));
  });
});

describe("an admin setting somebody's password", () => {
  let tenant: TestTenant;
  let target: string;

  const passwordOf = async () => {
    const db = await getDb();
    const rows = await db`
      SELECT password_hash FROM users WHERE id = ${target} AND tenant_id = ${tenant.tenantId}
    `;
    return rows[0] as { password_hash: string };
  };

  beforeAll(async () => {
    tenant = await createTestTenant({ companyName: "Password Co" });
    target = await addUser(tenant.tenantId, { roleKey: "employee", name: "Locked Out" });
  });
  afterAll(async () => {
    await tenant.drop();
  });

  it("sets the one they typed, and never echoes it back", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await resetUserPasswordAction(
      null,
      form({ userId: target, password: "Chosen Pass 1" })
    );
    expect(state?.success).toBeTruthy();
    expect(verifyPassword(await passwordOf(), "Chosen Pass 1")).toBe(true);
    // The administrator typed it; repeating it only puts it somewhere else.
    expect(state?.success).not.toContain("Chosen Pass 1");
  });

  it("generates one and shows it once when the field is left blank", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await resetUserPasswordAction(null, form({ userId: target }));
    const shown = /: (\S+) —/.exec(state?.success ?? "")?.[1];
    expect(shown).toBeTruthy();
    // Nobody knows a generated password yet, so it has to be readable once.
    expect(verifyPassword(await passwordOf(), shown!)).toBe(true);
  });

  it("refuses a weak one without touching the account", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const before = await passwordOf();
    const state = await resetUserPasswordAction(
      null,
      form({ userId: target, password: "weak" })
    );
    expect(state?.fieldErrors?.password).toBeTruthy();
    expect((await passwordOf()).password_hash).toBe(before.password_hash);
  });

  it("still refuses to reset the caller's own", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await resetUserPasswordAction(
      null,
      form({ userId: tenant.adminId, password: "Anything Goes 1" })
    );
    // A borrowed unlocked laptop must not become a permanent takeover.
    expect(state?.error).toMatch(/cannot reset your own/i);
  });
});

describe("deleting master data", () => {
  let tenant: TestTenant;
  let other: TestTenant;

  beforeAll(async () => {
    tenant = await createTestTenant({ companyName: "Cleanup Co" });
    other = await createTestTenant({ companyName: "Bystander Co" });
    await signInAs(tenant.adminId, tenant.tenantId);
  });
  afterAll(async () => {
    await tenant.drop();
    await other.drop();
  });

  it("removes a department nothing is filed under", async () => {
    const db = await getDb();
    const made = await db`
      INSERT INTO departments (tenant_id, name) VALUES (${tenant.tenantId}, 'Empty Dept')
      RETURNING id
    `;
    const id = (made[0] as { id: string }).id;
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await deleteDepartmentAction(null, form({ id }));
    expect(state?.success).toBeTruthy();
    const left = await db`
      SELECT COUNT(*)::int AS n FROM departments WHERE id = ${id} AND tenant_id = ${tenant.tenantId}
    `;
    expect((left[0] as { n: number }).n).toBe(0);
  });

  it("refuses a department that still has people in it, and keeps them filed", async () => {
    const db = await getDb();
    const made = await db`
      INSERT INTO departments (tenant_id, name) VALUES (${tenant.tenantId}, 'Staffed Dept')
      RETURNING id
    `;
    const id = (made[0] as { id: string }).id;
    const person = await addUser(tenant.tenantId, { roleKey: "employee", name: "Filed Person" });
    await db`
      UPDATE users SET department_id = ${id} WHERE id = ${person} AND tenant_id = ${tenant.tenantId}
    `;

    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await deleteDepartmentAction(null, form({ id }));
    expect(state?.error).toContain("1 employee");
    // The FK is ON DELETE SET NULL, so the database would have allowed this
    // and quietly unfiled them.
    const still = await db`
      SELECT department_id FROM users WHERE id = ${person} AND tenant_id = ${tenant.tenantId}
    `;
    expect((still[0] as { department_id: string | null }).department_id).toBe(id);
  });

  it("refuses a leave type somebody has already requested", async () => {
    const db = await getDb();
    const types = await db`
      SELECT id FROM leave_types WHERE tenant_id = ${tenant.tenantId} ORDER BY sort_order LIMIT 1
    `;
    const typeId = (types[0] as { id: string }).id;
    await db`
      INSERT INTO leave_requests
        (tenant_id, user_id, leave_type_id, start_date, end_date, days, status)
      VALUES (${tenant.tenantId}, ${tenant.adminId}, ${typeId}, '2026-10-01', '2026-10-01', 1, 'approved')
    `;
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await deleteLeaveTypeAction(null, form({ id: typeId }));
    expect(state?.error).toContain("1 leave request");
    const still = await db`
      SELECT COUNT(*)::int AS n FROM leave_types WHERE id = ${typeId} AND tenant_id = ${tenant.tenantId}
    `;
    expect((still[0] as { n: number }).n).toBe(1);
  });

  it("refuses a client with a deal, and keeps the deal", async () => {
    const db = await getDb();
    const client = await db`
      INSERT INTO clients (tenant_id, name) VALUES (${tenant.tenantId}, 'Traded With')
      RETURNING id
    `;
    const clientId = (client[0] as { id: string }).id;
    const stage = await db`
      SELECT id FROM pipeline_stages WHERE tenant_id = ${tenant.tenantId} ORDER BY sort_order LIMIT 1
    `;
    await db`
      INSERT INTO deals (tenant_id, client_id, title, stage_id, value)
      VALUES (${tenant.tenantId}, ${clientId}, 'A deal', ${(stage[0] as { id: string }).id}, 1000)
    `;

    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await deleteClientAction(null, form({ id: clientId }));
    expect(state?.error).toContain("1 deal");
    // deals.client_id is ON DELETE CASCADE: the database would have taken
    // the deal with it without a word.
    const deals = await db`
      SELECT COUNT(*)::int AS n FROM deals WHERE tenant_id = ${tenant.tenantId} AND client_id = ${clientId}
    `;
    expect((deals[0] as { n: number }).n).toBe(1);
  });

  it("will not reach into another company's data", async () => {
    const db = await getDb();
    const theirs = await db`
      INSERT INTO departments (tenant_id, name) VALUES (${other.tenantId}, 'Not Yours')
      RETURNING id
    `;
    const id = (theirs[0] as { id: string }).id;

    await signInAs(tenant.adminId, tenant.tenantId);
    const deleted = await deleteDepartmentAction(null, form({ id }));
    expect(deleted?.error).toMatch(/not found/i);
    const renamed = await updateDepartmentAction(
      null,
      form({ departmentId: id, name: "Hijacked" })
    );
    expect(renamed?.error).toMatch(/not found/i);

    const still = await db`
      SELECT name FROM departments WHERE id = ${id} AND tenant_id = ${other.tenantId}
    `;
    expect((still[0] as { name: string }).name).toBe("Not Yours");
  });

  it("refuses to rename a client into another company's reach", async () => {
    const db = await getDb();
    const theirs = await db`
      INSERT INTO clients (tenant_id, name) VALUES (${other.tenantId}, 'Their Client')
      RETURNING id
    `;
    const id = (theirs[0] as { id: string }).id;
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await updateClientAction(
      null,
      form({ clientId: id, name: "Mine Now", status: "active" })
    );
    expect(state?.error).toMatch(/not found/i);
    const still = await db`
      SELECT name FROM clients WHERE id = ${id} AND tenant_id = ${other.tenantId}
    `;
    expect((still[0] as { name: string }).name).toBe("Their Client");
  });
});

describe("the company holiday calendar", () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await createTestTenant({ companyName: "Calendar Admin Co" });
    await signInAs(tenant.adminId, tenant.tenantId);
  });
  afterAll(async () => {
    await tenant.drop();
  });

  it("can finally be filled in, which nothing could do before", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await saveHolidayAction(
      null,
      form({ date: "2026-12-16", name: "Victory Day" })
    );
    expect(state?.success).toBeTruthy();
    const db = await getDb();
    const rows = await db`
      SELECT name, holiday_date FROM holidays WHERE tenant_id = ${tenant.tenantId}
    `;
    expect(rows).toHaveLength(1);
    // A DATE stays a string the whole way; no zone is ever applied to it.
    expect((rows[0] as { holiday_date: string }).holiday_date).toBe("2026-12-16");
  });

  it("renames rather than duplicating a day already in the calendar", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    await saveHolidayAction(null, form({ date: "2026-12-16", name: "Victory Day (observed)" }));
    const db = await getDb();
    const rows = await db`
      SELECT name FROM holidays WHERE tenant_id = ${tenant.tenantId} AND holiday_date = '2026-12-16'
    `;
    expect(rows).toHaveLength(1);
    expect((rows[0] as { name: string }).name).toBe("Victory Day (observed)");
  });

  it("removes one, because nothing references a holiday", async () => {
    const db = await getDb();
    const rows = await db`
      SELECT id FROM holidays WHERE tenant_id = ${tenant.tenantId} LIMIT 1
    `;
    await signInAs(tenant.adminId, tenant.tenantId);
    const state = await deleteHolidayAction(null, form({ id: (rows[0] as { id: string }).id }));
    expect(state?.success).toBeTruthy();
    const left = await db`
      SELECT COUNT(*)::int AS n FROM holidays WHERE tenant_id = ${tenant.tenantId}
    `;
    expect((left[0] as { n: number }).n).toBe(0);
  });
});
