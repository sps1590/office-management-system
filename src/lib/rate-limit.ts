import "server-only";
import { getDb } from "./db";

/**
 * Fixed-window counter kept in Postgres rather than memory, because Vercel
 * runs many short-lived instances and an in-memory counter would reset
 * constantly — letting a brute-force attempt through by simply spreading
 * itself over new lambdas.
 *
 * Returns true when the call is allowed. The INSERT ... ON CONFLICT does the
 * increment and the read in one round trip.
 */
export async function allow(
  bucket: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const db = await getDb();
  // Truncate "now" to the start of its window so every caller in the same
  // period contends for the same row.
  const windowStart = new Date(
    Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000
  ).toISOString();

  const rows = await db`
    INSERT INTO rate_limits (bucket, window_start, hits)
    VALUES (${bucket}, ${windowStart}, 1)
    ON CONFLICT (bucket, window_start)
      DO UPDATE SET hits = rate_limits.hits + 1
    RETURNING hits
    -- tenancy-ok: rate limiting is keyed by an opaque bucket, not a tenant
  `;
  return (rows[0] as { hits: number }).hits <= limit;
}

/** Sign-in: 10 attempts per email per 10 minutes. */
export function loginBucket(email: string) {
  return `login:${email.toLowerCase()}`;
}

/** Company signup: 5 per IP per hour, to stop automated tenant creation. */
export function signupBucket(ip: string | null) {
  return `signup:${ip ?? "unknown"}`;
}

/** Telemetry ingest: generous, but a runaway device cannot flood the table. */
export function telemetryBucket(deviceId: string) {
  return `telemetry:${deviceId}`;
}
