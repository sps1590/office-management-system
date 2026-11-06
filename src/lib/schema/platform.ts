// SaaS platform level: subscription plans, tenant companies, per-tenant
// configuration. Nothing here is tenant-scoped except by being keyed on
// tenant_id itself, so these statements run first.

export const PLATFORM_SCHEMA: string[] = [
  // One row describing the schema this database is already at, so a cold
  // start can skip re-applying the whole list. See ensureSchema in db.ts.
  `CREATE TABLE IF NOT EXISTS schema_state (
     id          INTEGER PRIMARY KEY,
     fingerprint TEXT NOT NULL,
     applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS subscription_plans (
     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     key           TEXT NOT NULL UNIQUE,
     name          TEXT NOT NULL,
     price_monthly NUMERIC(12,2) NOT NULL DEFAULT 0,
     max_users     INTEGER,
     features      JSONB NOT NULL DEFAULT '{}'::jsonb,
     sort_order    INTEGER NOT NULL DEFAULT 0,
     is_active     BOOLEAN NOT NULL DEFAULT TRUE,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS tenants (
     id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     company_name   TEXT NOT NULL,
     slug           TEXT NOT NULL UNIQUE,
     domain         TEXT,
     status         TEXT NOT NULL DEFAULT 'trial',
     plan_key       TEXT NOT NULL DEFAULT 'starter',
     logo_url       TEXT,
     timezone       TEXT NOT NULL DEFAULT 'Asia/Dhaka',
     currency       TEXT NOT NULL DEFAULT 'BDT',
     country        TEXT,
     address        TEXT,
     phone          TEXT,
     email          TEXT,
     trial_ends_on  DATE,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT tenants_status_check
       CHECK (status IN ('trial','active','suspended','cancelled'))
   )`,

  `CREATE TABLE IF NOT EXISTS tenant_subscriptions (
     id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     plan_key   TEXT NOT NULL,
     status     TEXT NOT NULL DEFAULT 'active',
     started_on DATE NOT NULL DEFAULT CURRENT_DATE,
     renews_on  DATE,
     amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
     note       TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT tenant_subscriptions_status_check
       CHECK (status IN ('active','past_due','cancelled','expired'))
   )`,

  // One row per tenant. Holds every number an administrator can tune without
  // a deploy: the attendance/overtime formula, the GPS duty cycle and
  // retention limit, and the approval chains that drive PO and leave routing.
  `CREATE TABLE IF NOT EXISTS tenant_settings (
     tenant_id                 UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
     standard_work_minutes     INTEGER NOT NULL DEFAULT 480,
     work_start_time           TIME NOT NULL DEFAULT '09:00',
     grace_minutes             INTEGER NOT NULL DEFAULT 15,
     overtime_multiplier       NUMERIC(4,2) NOT NULL DEFAULT 1.50,
     overtime_after_minutes    INTEGER NOT NULL DEFAULT 480,
     weekend_days              INTEGER[] NOT NULL DEFAULT ARRAY[5,6],
     attendance_radius_meters  INTEGER NOT NULL DEFAULT 200,
     -- Off for a new company, deliberately. A fresh tenant has no geofences,
     -- so requiring one refuses every check-in on day one -- and location
     -- tracking of staff needs a written policy and notice first anyway.
     -- updateSettingsAction will not let it be switched on until an office
     -- fence exists to satisfy it.
     require_geofenced_checkin BOOLEAN NOT NULL DEFAULT FALSE,
     telemetry_interval_seconds INTEGER NOT NULL DEFAULT 60,
     telemetry_retention_days  INTEGER NOT NULL DEFAULT 90,
     tracking_window_start     TIME NOT NULL DEFAULT '07:00',
     tracking_window_end       TIME NOT NULL DEFAULT '21:00',
     deviation_threshold_meters INTEGER NOT NULL DEFAULT 1000,
     po_approval_tiers         JSONB NOT NULL DEFAULT '[]'::jsonb,
     leave_approval_stages     JSONB NOT NULL DEFAULT '["line_manager","hr_manager"]'::jsonb,
     fiscal_year_start_month   INTEGER NOT NULL DEFAULT 7,
     invoice_prefix            TEXT NOT NULL DEFAULT 'INV',
     po_prefix                 TEXT NOT NULL DEFAULT 'PO',
     updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // Per-tenant counters for human-readable document numbers (PO-00017,
  // INV-00042). A single UPDATE ... RETURNING hands out the next value
  // atomically, so two concurrent requests can never mint the same number --
  // which a MAX(...)+1 query would allow.
  `CREATE TABLE IF NOT EXISTS doc_sequences (
     tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     kind       TEXT NOT NULL,
     next_value INTEGER NOT NULL DEFAULT 1,
     PRIMARY KEY (tenant_id, kind)
   )`,

  // CREATE TABLE IF NOT EXISTS leaves an existing table's defaults alone, so
  // the change above reaches the deployed database only through this.
  `ALTER TABLE tenant_settings
     ALTER COLUMN require_geofenced_checkin SET DEFAULT FALSE`,

  // Releases any company already stuck in the state that default created:
  // check-in gated on a geofence, with no office or warehouse fence that
  // could ever satisfy it, so every check-in was refused. Companies that
  // have a fence are left exactly as their admin set them, and the state
  // this repairs is one `updateSettingsAction` now refuses to create.
  `UPDATE tenant_settings s
      SET require_geofenced_checkin = FALSE, updated_at = now()
    WHERE s.require_geofenced_checkin
      AND NOT EXISTS (
            SELECT 1 FROM geofences g
             WHERE g.tenant_id = s.tenant_id
               AND g.is_active
               AND g.kind IN ('office','warehouse'))
    -- tenancy-ok: one-off repair across every tenant, run by the schema
    -- applier before any session exists`,
];
