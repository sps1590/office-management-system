import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { nextDocNumber } from "@/lib/sequence";
import { createEmployeeAction } from "@/lib/actions/employees";
import { createTestTenant, form, signInAs, type TestTenant } from "../helpers/world";

/*
   Document numbers, and the collision that stopped every company from adding
   its first employee.

   `provision.ts` gives the signing-up admin `EMP-00001` and seeds the
   `employee` sequence at 2 so the next one is `EMP-00002`. The bug was an
   employee code drawn from a *different* kind's sequence -- which starts at 1
   -- so the first employee anyone added was handed `EMP-00001` again, hit the
   unique index on (tenant_id, employee_code), and crashed the page instead of
   reporting itself.

   Hence the rule in CLAUDE.md: a new `nextDocNumber` kind is a new entry in
   its union, never the nearest existing one. Sharing a counter is silent
   until it collides with whatever provisioning seeded.
*/
describe("document numbers", () => {
  let tenant: TestTenant;

  /** Every kind the union allows. */
  const KINDS = [
    "po",
    "invoice",
    "bill",
    "expense",
    "asset",
    "employee",
    "vendor",
    "client",
    "visitor",
  ] as const;

  beforeAll(async () => {
    tenant = await createTestTenant();
  });

  afterAll(async () => {
    await tenant.drop();
  });

  it("issues a separate sequence per kind", async () => {
    // One number of every kind, each with its own prefix.
    const issued = await Promise.all(
      KINDS.map((kind) => nextDocNumber(tenant.tenantId, kind, kind.toUpperCase().slice(0, 3)))
    );

    // Every kind that provisioning did not seed starts at 1. `employee` is
    // the exception, and the next test is about exactly that.
    for (const [i, kind] of KINDS.entries()) {
      if (kind === "employee") continue;
      expect(issued[i], `${kind} should start its own sequence at 1`).toMatch(/-00001$/);
    }

    const db = await getDb();
    const rows = await db`
      SELECT kind, next_value FROM doc_sequences WHERE tenant_id = ${tenant.tenantId}
       ORDER BY kind
    `;
    const counters = rows as unknown as { kind: string; next_value: number }[];

    // One counter per kind, and no kind missing — a kind reusing another's
    // entry would leave fewer rows than kinds.
    expect(counters).toHaveLength(KINDS.length);
    expect(counters.map((c) => c.kind).sort()).toEqual([...KINDS].sort());
  });

  it("does not let one kind advance another's counter", async () => {
    const db = await getDb();
    const before = await db`
      SELECT kind, next_value FROM doc_sequences WHERE tenant_id = ${tenant.tenantId}
    `;
    const snapshot = new Map(
      (before as unknown as { kind: string; next_value: number }[]).map((r) => [
        r.kind,
        r.next_value,
      ])
    );

    await nextDocNumber(tenant.tenantId, "po", "PO");
    await nextDocNumber(tenant.tenantId, "po", "PO");

    const after = await db`
      SELECT kind, next_value FROM doc_sequences WHERE tenant_id = ${tenant.tenantId}
    `;
    for (const row of after as unknown as { kind: string; next_value: number }[]) {
      const was = snapshot.get(row.kind)!;
      if (row.kind === "po") expect(row.next_value).toBe(was + 2);
      else expect(row.next_value, `${row.kind} moved when only po was asked`).toBe(was);
    }
  });

  it("starts the employee sequence where provisioning left it", async () => {
    // Its own tenant: the test above has already drawn numbers from this one.
    const fresh = await createTestTenant();
    try {
      const db = await getDb();
      const seeded = await db`
        SELECT next_value FROM doc_sequences
         WHERE tenant_id = ${fresh.tenantId} AND kind = 'employee'
      `;
      // Provisioning took EMP-00001 for the admin and seeded 2.
      expect((seeded[0] as { next_value: number }).next_value).toBe(2);
      expect(await nextDocNumber(fresh.tenantId, "employee", "EMP")).toBe("EMP-00002");
      expect(await nextDocNumber(fresh.tenantId, "employee", "EMP")).toBe("EMP-00003");
    } finally {
      await fresh.drop();
    }
  });

  it("lets a company add its first employee without colliding with its admin", async () => {
    // The end-to-end shape of the original bug: register, then add somebody.
    const fresh = await createTestTenant();
    try {
      const db = await getDb();
      const admin = await db`
        SELECT employee_code FROM users
         WHERE id = ${fresh.adminId} AND tenant_id = ${fresh.tenantId}
      `;
      expect((admin[0] as { employee_code: string }).employee_code).toBe("EMP-00001");

      await signInAs(fresh.adminId, fresh.tenantId);
      const created = await createEmployeeAction(
        null,
        form({
          fullName: "First Hire",
          email: `first-hire-${Math.random().toString(36).slice(2, 10)}@vitest.invalid`,
          employmentType: "permanent",
        })
      );
      expect(created?.error, created?.error).toBeUndefined();
      expect(created?.fieldErrors, JSON.stringify(created?.fieldErrors)).toBeUndefined();

      const codes = await db`
        SELECT employee_code FROM users
         WHERE tenant_id = ${fresh.tenantId} AND employee_code IS NOT NULL
         ORDER BY employee_code
      `;
      const list = (codes as unknown as { employee_code: string }[]).map((r) => r.employee_code);
      expect(list).toEqual(["EMP-00001", "EMP-00002"]);
    } finally {
      await fresh.drop();
    }
  });

  it("gives every caller a different number when they race", async () => {
    // The INSERT ... ON CONFLICT DO UPDATE claims and advances in one
    // statement; a SELECT MAX(...) + 1 would hand the same number to both.
    const issued = await Promise.all(
      Array.from({ length: 8 }, () => nextDocNumber(tenant.tenantId, "invoice", "INV"))
    );
    expect(new Set(issued).size).toBe(issued.length);
  });

  it("keeps each company's numbering to itself", async () => {
    const other = await createTestTenant();
    try {
      // This tenant has already issued several invoices; the new one has not.
      expect(await nextDocNumber(other.tenantId, "invoice", "INV")).toBe("INV-00001");
      const mine = await nextDocNumber(tenant.tenantId, "invoice", "INV");
      expect(mine).not.toBe("INV-00001");
    } finally {
      await other.drop();
    }
  });
});
