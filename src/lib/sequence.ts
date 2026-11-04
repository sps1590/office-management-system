import "server-only";
import { getDb } from "./db";

/**
 * Hands out the next document number for a tenant, atomically.
 *
 * The INSERT ... ON CONFLICT DO UPDATE both claims the value and advances the
 * counter in one statement, so two requests racing to create a purchase order
 * get different numbers. A `SELECT MAX(...) + 1` would not: both would read
 * the same maximum.
 */
export async function nextDocNumber(
  tenantId: string,
  kind: "po" | "invoice" | "bill" | "expense" | "asset" | "vendor" | "client" | "visitor",
  prefix: string
): Promise<string> {
  const db = await getDb();
  const rows = await db`
    INSERT INTO doc_sequences (tenant_id, kind, next_value)
    VALUES (${tenantId}, ${kind}, 2)
    ON CONFLICT (tenant_id, kind)
      DO UPDATE SET next_value = doc_sequences.next_value + 1
    RETURNING next_value
  `;
  // A fresh row returns 2 having reserved 1; an existing row returns the new
  // value having reserved the previous one. Either way, subtract one.
  const used = (rows[0] as { next_value: number }).next_value - 1;
  return `${prefix}-${String(used).padStart(5, "0")}`;
}
