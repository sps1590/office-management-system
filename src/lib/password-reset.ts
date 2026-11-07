import "server-only";
import crypto from "node:crypto";
import { getDb } from "./db";

/*
   Forgotten-password tokens.

   The token is 32 random bytes from `node:crypto`, never `Math.random()`,
   and only its SHA-256 is stored — the same shape as the device tokens in
   `device_registrations`. The readable value exists in one email and
   nowhere else, so a copy of this table opens nothing.

   Every boundary here is a duration rather than a calendar day, so no time
   zone is involved: `expires_at` is an instant compared against `now()`.
*/

/** How long a link stays usable. Long enough to find the email, short
 *  enough that one left in an inbox is not a standing key. */
export const RESET_TTL_MINUTES = 60;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a link for one account, invalidating any earlier unused one.
 *
 * Asking twice must not leave two working links: the second request is
 * usually somebody who did not receive the first, and the first may be in a
 * mailbox they no longer control.
 */
export async function issueResetToken(
  tenantId: string,
  userId: string,
  ip: string | null
): Promise<{ token: string; expiresAt: Date }> {
  const db = await getDb();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);

  await db`
    UPDATE password_resets SET used_at = now()
     WHERE user_id = ${userId} AND tenant_id = ${tenantId} AND used_at IS NULL
  `;
  await db`
    INSERT INTO password_resets (tenant_id, user_id, token_hash, expires_at, requested_ip)
    VALUES (${tenantId}, ${userId}, ${hashToken(token)}, ${expiresAt.toISOString()}, ${ip})
  `;
  return { token, expiresAt };
}

/**
 * Spends a token, or refuses.
 *
 * One `UPDATE … WHERE used_at IS NULL … RETURNING` does the check and the
 * burn together, so two browsers racing the same link cannot both win: the
 * second matches no row. A separate SELECT-then-UPDATE would let both
 * through.
 */
export async function consumeResetToken(
  token: string
): Promise<{ userId: string; tenantId: string } | null> {
  const db = await getDb();
  const rows = await db`
    UPDATE password_resets
       SET used_at = now()
     WHERE token_hash = ${hashToken(token)}
       AND used_at IS NULL
       AND expires_at > now()
    RETURNING user_id, tenant_id
    -- tenancy-ok: a reset link is spent before anybody is signed in, so
    -- there is no session tenant to scope by; the token itself names one
  `;
  const row = rows[0] as { user_id: string; tenant_id: string } | undefined;
  return row ? { userId: row.user_id, tenantId: row.tenant_id } : null;
}

/**
 * Whether a token is still worth showing a form for.
 *
 * Read-only, for the page itself: landing on a dead link should say so
 * before somebody types a new password into a form that cannot work.
 */
export async function resetTokenIsLive(token: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db`
    SELECT 1 FROM password_resets
     WHERE token_hash = ${hashToken(token)}
       AND used_at IS NULL
       AND expires_at > now()
    -- tenancy-ok: checked before sign-in, with no session tenant to scope by
  `;
  return rows.length > 0;
}
