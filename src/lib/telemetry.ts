import "server-only";
import crypto from "node:crypto";
import { getDb } from "./db";
import { getSettings } from "./settings";
import { evaluateFence, type Geofence, type Point } from "./geo";
import { notifyRoles } from "./audit";

/**
 * The server half of the enterprise GPS tracking engine (SRS 3.2).
 *
 * Device tokens are random, opaque and stored only as a SHA-256 hash, so a
 * leaked database does not yield working tokens. Every ingested point is
 * attributed from the token, never from the request body: a device can only
 * ever write its own user's location.
 *
 * See docs/MOBILE.md for the wire contract a native client implements.
 */

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function mintToken(): string {
  // 48 bytes of entropy, URL-safe — long enough that guessing is hopeless and
  // short enough to store in a mobile keystore comfortably.
  return crypto.randomBytes(48).toString("base64url");
}

export type ResolvedDevice = {
  deviceRowId: string;
  deviceId: string;
  tenantId: string;
  userId: string;
  intervalSeconds: number;
};

/** Looks a bearer token up. Returns null for unknown or deactivated devices. */
export async function resolveDevice(token: string): Promise<ResolvedDevice | null> {
  if (!token || token.length < 32) return null;
  const db = await getDb();
  const rows = await db`
    SELECT id, device_id, tenant_id, user_id, interval_seconds
      FROM device_registrations
     WHERE token_hash = ${hashToken(token)} AND is_active = TRUE
     -- tenancy-ok: the token itself identifies exactly one tenant's device
  `;
  const row = rows[0] as
    | {
        id: string;
        device_id: string;
        tenant_id: string;
        user_id: string;
        interval_seconds: number;
      }
    | undefined;
  if (!row) return null;
  return {
    deviceRowId: row.id,
    deviceId: row.device_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    intervalSeconds: row.interval_seconds,
  };
}

/**
 * Enrols a device against an authenticated user and returns the plaintext
 * token once. Re-enrolling the same device_id rotates its token, which is how
 * an MDM re-provisioning flow recovers from a lost keystore.
 */
export async function enrolDevice(input: {
  tenantId: string;
  userId: string;
  deviceId: string;
  platform: "android" | "ios" | "web";
  model?: string | null;
  mdmEnrolled?: boolean;
}): Promise<{ token: string; intervalSeconds: number }> {
  const db = await getDb();
  const settings = await getSettings(input.tenantId);
  const token = mintToken();

  await db`
    INSERT INTO device_registrations (tenant_id, user_id, device_id, platform, model,
                                      token_hash, mdm_enrolled, interval_seconds,
                                      is_active, last_seen_at)
    VALUES (${input.tenantId}, ${input.userId}, ${input.deviceId}, ${input.platform},
            ${input.model ?? null}, ${hashToken(token)}, ${input.mdmEnrolled ?? false},
            ${settings.telemetry_interval_seconds}, TRUE, now())
    ON CONFLICT (tenant_id, device_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          platform = EXCLUDED.platform,
          model = EXCLUDED.model,
          token_hash = EXCLUDED.token_hash,
          mdm_enrolled = EXCLUDED.mdm_enrolled,
          interval_seconds = EXCLUDED.interval_seconds,
          is_active = TRUE,
          last_seen_at = now()
  `;
  return { token, intervalSeconds: settings.telemetry_interval_seconds };
}

export type IncomingPoint = {
  latitude: number;
  longitude: number;
  log_timestamp?: string;
  accuracy_meters?: number;
  activity_state?: string;
  speed_kph?: number;
  heading?: number;
  battery_percent?: number;
};

const ACTIVITY_STATES = new Set([
  "In-Transit",
  "Idle",
  "Client-Meeting",
  "Stationary",
  "Walking",
  "Driving",
  "Unknown",
]);

function sanitise(p: IncomingPoint): IncomingPoint | null {
  const lat = Number(p.latitude);
  const lng = Number(p.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  // A timestamp from the future, or from before the company existed, is a
  // broken device clock rather than real history.
  let stamp = p.log_timestamp ? new Date(p.log_timestamp) : new Date();
  if (Number.isNaN(stamp.getTime())) stamp = new Date();
  const now = Date.now();
  if (stamp.getTime() > now + 60_000) stamp = new Date(now);
  if (stamp.getTime() < now - 30 * 86_400_000) return null;

  return {
    latitude: lat,
    longitude: lng,
    log_timestamp: stamp.toISOString(),
    accuracy_meters: Number.isFinite(Number(p.accuracy_meters))
      ? Math.min(100_000, Math.max(0, Number(p.accuracy_meters)))
      : undefined,
    activity_state:
      p.activity_state && ACTIVITY_STATES.has(p.activity_state) ? p.activity_state : undefined,
    speed_kph: Number.isFinite(Number(p.speed_kph))
      ? Math.min(1000, Math.max(0, Number(p.speed_kph)))
      : undefined,
    heading: Number.isFinite(Number(p.heading))
      ? ((Number(p.heading) % 360) + 360) % 360
      : undefined,
    battery_percent: Number.isFinite(Number(p.battery_percent))
      ? Math.min(100, Math.max(0, Math.round(Number(p.battery_percent))))
      : undefined,
  };
}

/**
 * Writes a batch of coordinates and evaluates geofences on the newest point.
 *
 * Idempotent: the unique index on (device_id, log_timestamp) means a retried
 * batch is silently de-duplicated rather than duplicating a route.
 */
export async function ingestPoints(
  device: ResolvedDevice,
  points: IncomingPoint[]
): Promise<{ accepted: number; rejected: number; geofenceEvents: number }> {
  const db = await getDb();
  const clean = points.map(sanitise).filter((p): p is IncomingPoint => p !== null);
  const rejected = points.length - clean.length;
  if (clean.length === 0) return { accepted: 0, rejected, geofenceEvents: 0 };

  // Oldest first, so the newest point is the last one written and the
  // geofence check below runs against the device's current position.
  clean.sort((a, b) => (a.log_timestamp ?? "").localeCompare(b.log_timestamp ?? ""));

  let accepted = 0;
  for (const p of clean) {
    const result = await db`
      INSERT INTO location_logs (tenant_id, user_id, device_id, latitude, longitude,
                                 log_timestamp, accuracy_meters, activity_state,
                                 speed_kph, heading, battery_percent)
      VALUES (${device.tenantId}, ${device.userId}, ${device.deviceRowId},
              ${p.latitude}, ${p.longitude}, ${p.log_timestamp},
              ${p.accuracy_meters ?? null}, ${p.activity_state ?? null},
              ${p.speed_kph ?? null}, ${p.heading ?? null}, ${p.battery_percent ?? null})
      ON CONFLICT (device_id, log_timestamp) DO NOTHING
      RETURNING id
    `;
    if (result.length > 0) accepted += 1;
  }

  await db`
    UPDATE device_registrations SET last_seen_at = now()
     WHERE id = ${device.deviceRowId} AND tenant_id = ${device.tenantId}
  `;

  const latest = clean[clean.length - 1];
  const geofenceEvents = await evaluateGeofences(device, {
    latitude: latest.latitude,
    longitude: latest.longitude,
  });

  return { accepted, rejected, geofenceEvents };
}

/**
 * Checks the device's newest position against the fences assigned to its user
 * and records enter / exit / deviation events.
 *
 * An event is only written when the state actually changed, so a stationary
 * device inside its territory does not generate a row every minute.
 */
async function evaluateGeofences(
  device: ResolvedDevice,
  point: Point
): Promise<number> {
  const db = await getDb();
  const settings = await getSettings(device.tenantId);

  const fenceRows = await db`
    SELECT g.id, g.name, g.shape, g.center_lat, g.center_lng, g.radius_meters,
           g.polygon, g.alert_on_enter, g.alert_on_exit, g.kind
      FROM geofences g
      JOIN geofence_assignments ga ON ga.geofence_id = g.id
     WHERE g.tenant_id = ${device.tenantId} AND g.is_active = TRUE
       AND ga.user_id = ${device.userId}
  `;
  const fences = fenceRows as unknown as (Geofence & {
    alert_on_enter: boolean;
    alert_on_exit: boolean;
    kind: string;
  })[];
  if (fences.length === 0) return 0;

  let written = 0;
  for (const fence of fences) {
    const { inside, distance } = evaluateFence(point, fence);

    const lastRows = await db`
      SELECT event_type FROM geofence_events
       WHERE tenant_id = ${device.tenantId} AND user_id = ${device.userId}
         AND geofence_id = ${fence.id}
       ORDER BY occurred_at DESC
       LIMIT 1
    `;
    const last = (lastRows[0] as { event_type: string } | undefined)?.event_type;
    const wasInside = last === "enter";

    let eventType: "enter" | "exit" | "deviation" | null = null;
    if (inside && !wasInside) eventType = "enter";
    else if (!inside && (wasInside || last === undefined)) {
      // Outside its assigned territory by more than the tolerance is a
      // deviation; just outside the line is an ordinary exit.
      eventType =
        fence.shape === "circle" &&
        distance != null &&
        distance - (fence.radius_meters ?? 0) > settings.deviation_threshold_meters
          ? "deviation"
          : "exit";
      // Never raise an exit for a fence the device was never inside, unless
      // it is a real deviation worth telling a manager about.
      if (last === undefined && eventType === "exit") eventType = null;
    }
    if (!eventType) continue;

    await db`
      INSERT INTO geofence_events (tenant_id, user_id, geofence_id, event_type,
                                   latitude, longitude, distance_meters)
      VALUES (${device.tenantId}, ${device.userId}, ${fence.id}, ${eventType},
              ${point.latitude}, ${point.longitude}, ${distance})
    `;
    written += 1;

    const shouldAlert =
      eventType === "deviation" ||
      (eventType === "enter" && fence.alert_on_enter) ||
      (eventType === "exit" && fence.alert_on_exit);

    if (shouldAlert) {
      const nameRows = await db`
        SELECT full_name FROM users
         WHERE id = ${device.userId} AND tenant_id = ${device.tenantId}
      `;
      const who = (nameRows[0] as { full_name: string } | undefined)?.full_name ?? "A field user";
      await notifyRoles(
        device.tenantId,
        ["it_mis_manager", "fleet_manager", "company_admin"],
        {
          title:
            eventType === "deviation"
              ? `Route deviation: ${who}`
              : `${who} ${eventType === "enter" ? "entered" : "left"} ${fence.name}`,
          body:
            eventType === "deviation"
              ? `${who} is ${Math.round(distance ?? 0)} m outside ${fence.name}.`
              : `Geofence ${fence.name}.`,
          kind: "geofence",
          severity: eventType === "deviation" ? "high" : "normal",
          link: "/tracking/map",
        }
      );
    }
  }
  return written;
}

/** Retention purge, run from the data-governance screen. */
export async function purgeOldTelemetry(tenantId: string): Promise<number> {
  const db = await getDb();
  const settings = await getSettings(tenantId);
  const rows = await db`
    DELETE FROM location_logs
     WHERE tenant_id = ${tenantId}
       AND log_timestamp < now() - make_interval(days => ${settings.telemetry_retention_days})
    RETURNING id
  `;
  return rows.length;
}
