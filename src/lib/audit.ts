import "server-only";
import { headers } from "next/headers";
import { getDb } from "./db";

/**
 * Data-governance trail for the IT & MIS module (SRS 3.1). Called from
 * Server Actions after a successful mutation.
 *
 * Deliberately swallows its own errors: an audit write that fails must not
 * roll back or mask the business operation the user just completed. A missing
 * audit row is visible in the log viewer; a failed salary payment is not.
 */
export async function audit(entry: {
  tenantId: string;
  userId: string | null;
  action: string;
  entity?: string;
  entityId?: string | null;
  summary?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = await getDb();
    const h = await headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;

    await db`
      INSERT INTO audit_logs (tenant_id, user_id, action, entity, entity_id, summary, meta, ip)
      VALUES (${entry.tenantId}, ${entry.userId}, ${entry.action},
              ${entry.entity ?? null}, ${entry.entityId ?? null},
              ${entry.summary ?? null}, ${JSON.stringify(entry.meta ?? {})}::jsonb, ${ip})
    `;
  } catch {
    // Intentionally ignored — see the note above.
  }
}

/** In-app notification. Same contract: never let delivery break a mutation. */
export async function notify(entry: {
  tenantId: string;
  userId: string;
  title: string;
  body?: string;
  kind?: string;
  severity?: "low" | "normal" | "high" | "critical";
  link?: string;
  entity?: string;
  entityId?: string | null;
}): Promise<void> {
  try {
    const db = await getDb();
    await db`
      INSERT INTO notifications (tenant_id, user_id, title, body, kind, severity, link, entity, entity_id)
      VALUES (${entry.tenantId}, ${entry.userId}, ${entry.title}, ${entry.body ?? null},
              ${entry.kind ?? "info"}, ${entry.severity ?? "normal"},
              ${entry.link ?? null}, ${entry.entity ?? null}, ${entry.entityId ?? null})
    `;
  } catch {
    // Intentionally ignored.
  }
}

/** Notifies every user in a tenant holding one of the given role keys. */
export async function notifyRoles(
  tenantId: string,
  roleKeys: string[],
  entry: Omit<Parameters<typeof notify>[0], "tenantId" | "userId">
): Promise<void> {
  try {
    const db = await getDb();
    const rows = await db`
      SELECT u.id FROM users u
        JOIN roles r ON r.id = u.role_id
       WHERE u.tenant_id = ${tenantId}
         AND u.status = 'active'
         AND r.key = ANY(${roleKeys})
    `;
    for (const row of rows as { id: string }[]) {
      await notify({ ...entry, tenantId, userId: row.id });
    }
  } catch {
    // Intentionally ignored.
  }
}
