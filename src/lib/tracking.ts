import "server-only";
import { getDb } from "./db";
import { simplifyRoute } from "./geo";

export type LivePosition = {
  user_id: string;
  full_name: string;
  role_name: string | null;
  role_key: string | null;
  latitude: number;
  longitude: number;
  log_timestamp: string;
  accuracy_meters: number | null;
  activity_state: string | null;
  speed_kph: number | null;
  battery_percent: number | null;
  registration_number: string | null;
};

/**
 * Latest position per user — the query behind the live operations map.
 *
 * DISTINCT ON walks the (tenant_id, user_id, log_timestamp DESC) index once
 * per user and stops, rather than sorting the whole table. With a month of
 * minute-by-minute telemetry that is the difference between milliseconds and
 * seconds.
 */
export async function livePositions(
  tenantId: string,
  staleMinutes = 120
): Promise<LivePosition[]> {
  const db = await getDb();
  const rows = await db`
    SELECT DISTINCT ON (l.user_id)
           l.user_id, l.latitude::float AS latitude, l.longitude::float AS longitude,
           l.log_timestamp, l.accuracy_meters::float AS accuracy_meters,
           l.activity_state, l.speed_kph::float AS speed_kph, l.battery_percent,
           u.full_name, r.role_name, r.key AS role_key,
           v.registration_number
      FROM location_logs l
      JOIN users u      ON u.id = l.user_id
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN vehicles v ON v.assigned_driver_id = u.id
     WHERE l.tenant_id = ${tenantId}
       AND l.log_timestamp > now() - make_interval(mins => ${staleMinutes})
     ORDER BY l.user_id, l.log_timestamp DESC
  `;
  return rows as unknown as LivePosition[];
}

/** One user's route for a day, thinned so a parked vehicle is not a thousand points. */
export async function userRoute(
  tenantId: string,
  userId: string,
  date: string
): Promise<{ latitude: number; longitude: number; log_timestamp: string }[]> {
  const db = await getDb();
  const rows = await db`
    SELECT latitude::float AS latitude, longitude::float AS longitude, log_timestamp
      FROM location_logs
     WHERE tenant_id = ${tenantId} AND user_id = ${userId}
       AND log_timestamp >= ${date}::date
       AND log_timestamp < ${date}::date + 1
     ORDER BY log_timestamp
  `;
  return simplifyRoute(
    rows as unknown as { latitude: number; longitude: number; log_timestamp: string }[]
  );
}

export async function listGeofences(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT g.id, g.name, g.kind, g.shape, g.center_lat::float AS center_lat,
           g.center_lng::float AS center_lng, g.radius_meters, g.polygon,
           g.color, g.alert_on_enter, g.alert_on_exit, g.is_active,
           (SELECT COUNT(*)::int FROM geofence_assignments ga
             WHERE ga.geofence_id = g.id) AS assigned_count
      FROM geofences g
     WHERE g.tenant_id = ${tenantId}
     ORDER BY g.kind, g.name
  `;
  return rows as unknown as {
    id: string;
    name: string;
    kind: string;
    shape: "circle" | "polygon";
    center_lat: number | null;
    center_lng: number | null;
    radius_meters: number | null;
    polygon: [number, number][];
    color: string;
    alert_on_enter: boolean;
    alert_on_exit: boolean;
    is_active: boolean;
    assigned_count: number;
  }[];
}

export async function listGeofenceEvents(tenantId: string, limit = 40) {
  const db = await getDb();
  const rows = await db`
    SELECT e.id, e.event_type, e.occurred_at, e.latitude::float AS latitude,
           e.longitude::float AS longitude, e.distance_meters::float AS distance_meters,
           u.full_name, g.name AS geofence_name, g.kind
      FROM geofence_events e
      JOIN users u          ON u.id = e.user_id
      LEFT JOIN geofences g ON g.id = e.geofence_id
     WHERE e.tenant_id = ${tenantId}
     ORDER BY e.occurred_at DESC
     LIMIT ${limit}
  `;
  return rows as unknown as {
    id: string;
    event_type: string;
    occurred_at: string;
    latitude: number | null;
    longitude: number | null;
    distance_meters: number | null;
    full_name: string;
    geofence_name: string | null;
    kind: string | null;
  }[];
}

export async function listDevices(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT d.id, d.device_id, d.platform, d.model, d.mdm_enrolled, d.is_active,
           d.interval_seconds, d.last_seen_at, u.full_name,
           (SELECT COUNT(*)::int FROM location_logs l
             WHERE l.device_id = d.id
               AND l.log_timestamp > now() - INTERVAL '24 hours') AS points_today
      FROM device_registrations d
      JOIN users u ON u.id = d.user_id
     WHERE d.tenant_id = ${tenantId}
     ORDER BY d.last_seen_at DESC NULLS LAST
  `;
  return rows as unknown as {
    id: string;
    device_id: string;
    platform: string;
    model: string | null;
    mdm_enrolled: boolean;
    is_active: boolean;
    interval_seconds: number;
    last_seen_at: string | null;
    full_name: string;
    points_today: number;
  }[];
}

export async function trackingStats(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT (SELECT COUNT(DISTINCT user_id)::int FROM location_logs
             WHERE tenant_id = ${tenantId}
               AND log_timestamp > now() - INTERVAL '15 minutes')          AS live_now,
           (SELECT COUNT(DISTINCT user_id)::int FROM location_logs
             WHERE tenant_id = ${tenantId}
               AND log_timestamp > now() - INTERVAL '24 hours')            AS active_today,
           (SELECT COUNT(*)::int FROM location_logs
             WHERE tenant_id = ${tenantId}
               AND log_timestamp > now() - INTERVAL '24 hours')            AS points_today,
           (SELECT COUNT(*)::int FROM geofence_events
             WHERE tenant_id = ${tenantId} AND event_type = 'deviation'
               AND occurred_at > now() - INTERVAL '24 hours')              AS deviations_today,
           (SELECT COUNT(*)::int FROM device_registrations
             WHERE tenant_id = ${tenantId} AND is_active = TRUE)           AS devices,
           (SELECT COUNT(*)::int FROM device_registrations
             WHERE tenant_id = ${tenantId} AND is_active = TRUE
               AND mdm_enrolled = TRUE)                                    AS mdm_devices
  `;
  return rows[0] as {
    live_now: number;
    active_today: number;
    points_today: number;
    deviations_today: number;
    devices: number;
    mdm_devices: number;
  };
}

/** Warehouses and clients, so the map shows fixed sites alongside people. */
export async function mapSites(tenantId: string) {
  const db = await getDb();
  const [warehouses, clients] = await Promise.all([
    db`
      SELECT id, name, latitude::float AS latitude, longitude::float AS longitude
        FROM warehouses
       WHERE tenant_id = ${tenantId} AND latitude IS NOT NULL AND longitude IS NOT NULL
    `,
    db`
      SELECT id, name, latitude::float AS latitude, longitude::float AS longitude
        FROM clients
       WHERE tenant_id = ${tenantId} AND latitude IS NOT NULL AND longitude IS NOT NULL
       LIMIT 300
    `,
  ]);
  return {
    warehouses: warehouses as unknown as {
      id: string;
      name: string;
      latitude: number;
      longitude: number;
    }[],
    clients: clients as unknown as {
      id: string;
      name: string;
      latitude: number;
      longitude: number;
    }[],
  };
}
