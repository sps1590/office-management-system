import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { provisionTenant } from "@/lib/provision";
import { __setSessionCookie } from "../stubs/next-headers";
import { TEST_SLUG_PREFIX } from "./env";

/*
   Builds the companies a test acts on, through the product's own signup
   path rather than from a fixture file. `provisionTenant` is what registering
   a company actually runs, so a tenant here has the same nine role copies,
   seventeen accounts, five leave types, six pipeline stages, settings row and
   `EMP-00001` admin that a real one does -- which is the point: the EMP-00001
   collision and the geofence-requirement dead end were both properties of a
   *freshly provisioned* tenant, and a hand-built fixture would have had
   neither.
*/

export type TestTenant = {
  tenantId: string;
  adminId: string;
  slug: string;
  /** Deletes the tenant. ON DELETE CASCADE takes everything with it. */
  drop: () => Promise<void>;
};

/** Collision-proof within a run and recognisable to the safety interlock. */
function uniqueSuffix(): string {
  return crypto.randomBytes(5).toString("hex");
}

export async function createTestTenant(
  options: { companyName?: string; timezone?: string; currency?: string } = {}
): Promise<TestTenant> {
  const suffix = uniqueSuffix();
  const slug = `${TEST_SLUG_PREFIX}${suffix}`;
  const { tenantId, userId } = await provisionTenant({
    companyName: options.companyName ?? `Vitest Co ${suffix}`,
    slug,
    adminName: "Test Admin",
    adminEmail: `admin-${suffix}@vitest.invalid`,
    // A real bcrypt hash is ~80 ms of CPU and no test signs in with a
    // password; the sessions are created directly.
    passwordHash: "$2b$10$notarealhashnotarealhashnotarealhashnotarealhashnotar",
    timezone: options.timezone ?? "Asia/Dhaka",
    currency: options.currency ?? "BDT",
  });

  return {
    tenantId,
    adminId: userId,
    slug,
    drop: () => dropTenant(tenantId),
  };
}

export async function dropTenant(tenantId: string): Promise<void> {
  const db = await getDb();
  await db`DELETE FROM tenants WHERE id = ${tenantId}
           -- tenancy-ok: test teardown deletes one tenant by its own id`;
}

/**
 * Adds an active user holding one of the tenant's roles. `roleKey` is a key
 * from the tenant's own role copies ("hr_manager", "procurement_manager",
 * "employee", "company_admin", …), or null for someone with no role at all.
 */
export async function addUser(
  tenantId: string,
  options: {
    roleKey?: string | null;
    name?: string;
    lineManagerId?: string | null;
    status?: "active" | "invited" | "suspended" | "left";
    employeeCode?: string | null;
  } = {}
): Promise<string> {
  const db = await getDb();
  const suffix = uniqueSuffix();
  const roleKey = options.roleKey === undefined ? "employee" : options.roleKey;

  let roleId: string | null = null;
  if (roleKey) {
    const roles = await db`
      SELECT id FROM roles WHERE tenant_id = ${tenantId} AND key = ${roleKey}
    `;
    roleId = (roles[0] as { id: string } | undefined)?.id ?? null;
    if (!roleId) throw new Error(`This tenant has no role "${roleKey}"`);
  }

  const rows = await db`
    INSERT INTO users (tenant_id, role_id, line_manager_id, full_name, email,
                       password_hash, employee_code, designation, status)
    VALUES (${tenantId}, ${roleId}, ${options.lineManagerId ?? null},
            ${options.name ?? `Test ${roleKey ?? "user"} ${suffix}`},
            ${`user-${suffix}@vitest.invalid`},
            ${"$2b$10$notarealhashnotarealhashnotarealhashnotarealhashnotar"},
            ${options.employeeCode ?? null}, ${roleKey ?? "Staff"},
            ${options.status ?? "active"})
    RETURNING id
  `;
  return (rows[0] as { id: string }).id;
}

/**
 * Makes the next Server Action run as this user, by writing a real session
 * row and handing its id to the `next/headers` stub. `requireUser()` then
 * resolves it exactly as it does in a request.
 */
export async function signInAs(userId: string, tenantId: string): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db`
    INSERT INTO sessions (id, user_id, tenant_id, expires_at, ip, user_agent)
    VALUES (${id}, ${userId}, ${tenantId},
            ${new Date(Date.now() + 3_600_000).toISOString()}, '127.0.0.1', 'vitest')
  `;
  __setSessionCookie(id);
  return id;
}

/** Nobody signed in — for asserting that an action refuses an anonymous call. */
export function signOut(): void {
  __setSessionCookie(null);
}

/** A FormData from a plain object, the way a browser would submit one. */
export function form(values: Record<string, string | number | boolean | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    // An unchecked checkbox is absent from a submission, not "false" — which
    // is exactly what `get("x") === "on"` in the actions relies on.
    if (value === false) continue;
    data.set(key, value === true ? "on" : String(value));
  }
  return data;
}

/** Deletes every tenant the suite has ever created in this database. */
export async function dropAllTestTenants(): Promise<number> {
  const db = await getDb();
  const rows = await db`
    DELETE FROM tenants WHERE slug LIKE ${`${TEST_SLUG_PREFIX}%`} RETURNING id
    -- tenancy-ok: test teardown, and only ever tenants the suite named
  `;
  return rows.length;
}
