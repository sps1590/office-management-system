import "server-only";
import { getDb } from "./db";
import type { Shift } from "./work-pattern";

/**
 * Shift lookups. The arithmetic these feed lives in `work-pattern.ts`, which
 * carries no `server-only` marker so the day picker can render in a browser.
 */

export type { Shift } from "./work-pattern";

/* --- queries -------------------------------------------------------------- */

export async function listShifts(tenantId: string): Promise<Shift[]> {
  const db = await getDb();
  const rows = await db`
    SELECT s.id, s.name, s.start_time, s.end_time, s.break_minutes,
           s.work_days, s.grace_minutes, s.is_active,
           COUNT(u.id)::int AS user_count
      FROM shifts s
      LEFT JOIN users u ON u.shift_id = s.id AND u.tenant_id = ${tenantId}
     WHERE s.tenant_id = ${tenantId}
     GROUP BY s.id
     ORDER BY s.start_time, s.name
  `;
  return rows as unknown as Shift[];
}

/** The shift one person is on, or null when they follow the company default. */
export async function shiftForUser(tenantId: string, userId: string): Promise<Shift | null> {
  const db = await getDb();
  const rows = await db`
    SELECT s.id, s.name, s.start_time, s.end_time, s.break_minutes,
           s.work_days, s.grace_minutes, s.is_active
      FROM users u
      JOIN shifts s ON s.id = u.shift_id AND s.tenant_id = ${tenantId}
     WHERE u.id = ${userId} AND u.tenant_id = ${tenantId} AND s.is_active = TRUE
  `;
  return (rows[0] as Shift | undefined) ?? null;
}

/**
 * Every active employee with the shift they are on, for the assignment screen.
 * One query, not one per person.
 */
export async function staffWithShifts(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT u.id, u.full_name, u.employee_code, u.email,
           s.id AS shift_id, s.name AS shift_name,
           d.name AS department_name
      FROM users u
      LEFT JOIN shifts s      ON s.id = u.shift_id
      LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.tenant_id = ${tenantId} AND u.status = 'active'
     ORDER BY u.full_name
  `;
  return rows as unknown as {
    id: string;
    full_name: string;
    employee_code: string | null;
    email: string;
    shift_id: string | null;
    shift_name: string | null;
    department_name: string | null;
  }[];
}
