// SRS 3.2 / 4.1 — Enterprise Background GPS Tracking Engine.
//
// device_registrations is what makes ingest safe: an MDM-provisioned app
// enrols once, and every coordinate it later posts is attributed from the
// token's hash, never from the request body. See docs/MOBILE.md for the wire
// contract.

export const TELEMETRY_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS device_registrations (
     id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     device_id        TEXT NOT NULL,
     platform         TEXT NOT NULL DEFAULT 'web',
     model            TEXT,
     token_hash       TEXT NOT NULL,
     mdm_enrolled     BOOLEAN NOT NULL DEFAULT FALSE,
     is_active        BOOLEAN NOT NULL DEFAULT TRUE,
     interval_seconds INTEGER NOT NULL DEFAULT 60,
     last_seen_at     TIMESTAMPTZ,
     created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT device_registrations_platform_check
       CHECK (platform IN ('android','ios','web')),
     UNIQUE (tenant_id, device_id)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS device_registrations_token_idx
     ON device_registrations (token_hash)`,

  // SRS 4.1 names id, user_id, latitude, longitude, log_timestamp,
  // accuracy_meters and activity_state. speed/heading/battery are added
  // because a fleet map without speed is not actionable and a tracker app
  // without battery telemetry gets blamed for flat phones.
  //
  // The (device_id, log_timestamp) unique index makes ingest idempotent: a
  // mobile client retrying an unacknowledged batch cannot duplicate history.
  `CREATE TABLE IF NOT EXISTS location_logs (
     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     device_id       UUID REFERENCES device_registrations(id) ON DELETE SET NULL,
     latitude        NUMERIC(10,7) NOT NULL,
     longitude       NUMERIC(10,7) NOT NULL,
     log_timestamp   TIMESTAMPTZ NOT NULL,
     accuracy_meters NUMERIC(8,2),
     activity_state  TEXT,
     speed_kph       NUMERIC(6,2),
     heading         NUMERIC(6,2),
     battery_percent INTEGER,
     created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT location_logs_lat_range CHECK (latitude BETWEEN -90 AND 90),
     CONSTRAINT location_logs_lng_range CHECK (longitude BETWEEN -180 AND 180)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS location_logs_device_time_idx
     ON location_logs (device_id, log_timestamp) WHERE device_id IS NOT NULL`,

  // Circle or polygon. A circle is cheap to evaluate in SQL on every ingested
  // point; a polygon is evaluated in TypeScript with a ray-cast test. Both
  // are supported because an office radius and a sales territory are
  // genuinely different shapes.
  `CREATE TABLE IF NOT EXISTS geofences (
     id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     name           TEXT NOT NULL,
     kind           TEXT NOT NULL DEFAULT 'office',
     shape          TEXT NOT NULL DEFAULT 'circle',
     center_lat     NUMERIC(10,7),
     center_lng     NUMERIC(10,7),
     radius_meters  INTEGER,
     polygon        JSONB NOT NULL DEFAULT '[]'::jsonb,
     color          TEXT NOT NULL DEFAULT '#6366f1',
     alert_on_exit  BOOLEAN NOT NULL DEFAULT FALSE,
     alert_on_enter BOOLEAN NOT NULL DEFAULT FALSE,
     is_active      BOOLEAN NOT NULL DEFAULT TRUE,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT geofences_kind_check
       CHECK (kind IN ('office','territory','client','warehouse','route','restricted')),
     CONSTRAINT geofences_shape_check CHECK (shape IN ('circle','polygon')),
     UNIQUE (tenant_id, name)
   )`,

  // Territory assignment: which users a fence applies to. Without a row here
  // a fence is informational only (drawn on the map, no alerts).
  `CREATE TABLE IF NOT EXISTS geofence_assignments (
     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     geofence_id UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
     user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (geofence_id, user_id)
   )`,

  `CREATE TABLE IF NOT EXISTS geofence_events (
     id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     geofence_id      UUID REFERENCES geofences(id) ON DELETE CASCADE,
     event_type       TEXT NOT NULL,
     occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     latitude         NUMERIC(10,7),
     longitude        NUMERIC(10,7),
     distance_meters  NUMERIC(12,2),
     notified         BOOLEAN NOT NULL DEFAULT FALSE,
     created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT geofence_events_type_check
       CHECK (event_type IN ('enter','exit','deviation'))
   )`,

  // attendance_records.geofence_id was declared without a constraint because
  // HR tables are created before geofences exists.
  `ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_geofence_fk`,
  `ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_geofence_fk
     FOREIGN KEY (geofence_id) REFERENCES geofences(id) ON DELETE SET NULL`,
];
