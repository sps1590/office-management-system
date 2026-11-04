// SRS 3.6 — Sales, Marketing & Field Operations.
// Clients with recorded coordinates (so a field visit can be verified against
// them), a configurable pipeline, deals, activity log, GPS-verified field
// visits, and monthly sales targets for the MIS dashboard.

export const CRM_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS clients (
     id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     client_code    TEXT,
     name           TEXT NOT NULL,
     industry       TEXT,
     contact_person TEXT,
     email          TEXT,
     phone          TEXT,
     website        TEXT,
     address        TEXT,
     latitude       NUMERIC(10,7),
     longitude      NUMERIC(10,7),
     owner_id       UUID REFERENCES users(id) ON DELETE SET NULL,
     status         TEXT NOT NULL DEFAULT 'lead',
     source         TEXT,
     notes          TEXT,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT clients_status_check
       CHECK (status IN ('lead','prospect','active','inactive','churned'))
   )`,

  `CREATE TABLE IF NOT EXISTS pipeline_stages (
     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     key         TEXT NOT NULL,
     name        TEXT NOT NULL,
     sort_order  INTEGER NOT NULL DEFAULT 0,
     probability INTEGER NOT NULL DEFAULT 0,
     is_won      BOOLEAN NOT NULL DEFAULT FALSE,
     is_lost     BOOLEAN NOT NULL DEFAULT FALSE,
     color       TEXT NOT NULL DEFAULT '#6366f1',
     UNIQUE (tenant_id, key)
   )`,

  `CREATE TABLE IF NOT EXISTS deals (
     id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     client_id           UUID REFERENCES clients(id) ON DELETE SET NULL,
     title               TEXT NOT NULL,
     description         TEXT,
     value               NUMERIC(16,2) NOT NULL DEFAULT 0,
     currency            TEXT NOT NULL DEFAULT 'BDT',
     stage_id            UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
     lead_source         TEXT,
     owner_id            UUID REFERENCES users(id) ON DELETE SET NULL,
     expected_close_date DATE,
     status              TEXT NOT NULL DEFAULT 'open',
     closed_at           TIMESTAMPTZ,
     lost_reason         TEXT,
     created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT deals_status_check CHECK (status IN ('open','won','lost'))
   )`,

  `CREATE TABLE IF NOT EXISTS deal_activities (
     id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     deal_id          UUID REFERENCES deals(id) ON DELETE CASCADE,
     client_id        UUID REFERENCES clients(id) ON DELETE CASCADE,
     user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
     activity_type    TEXT NOT NULL DEFAULT 'note',
     subject          TEXT,
     body             TEXT,
     occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     duration_minutes INTEGER,
     created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT deal_activities_type_check
       CHECK (activity_type IN ('call','email','meeting','note','visit','demo','proposal'))
   )`,

  // Proof of presence (SRS 3.2 / 3.6): checking in stamps coordinates, and
  // verification_distance_m records how far that was from the client's own
  // recorded location. verified is set by the server, never by the client.
  `CREATE TABLE IF NOT EXISTS field_visits (
     id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     client_id               UUID REFERENCES clients(id) ON DELETE SET NULL,
     deal_id                 UUID REFERENCES deals(id) ON DELETE SET NULL,
     purpose                 TEXT NOT NULL,
     planned_for             TIMESTAMPTZ,
     checked_in_at           TIMESTAMPTZ,
     check_in_lat            NUMERIC(10,7),
     check_in_lng            NUMERIC(10,7),
     checked_out_at          TIMESTAMPTZ,
     check_out_lat           NUMERIC(10,7),
     check_out_lng           NUMERIC(10,7),
     outcome                 TEXT,
     notes                   TEXT,
     status                  TEXT NOT NULL DEFAULT 'planned',
     verified                BOOLEAN NOT NULL DEFAULT FALSE,
     verification_distance_m NUMERIC(10,2),
     created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT field_visits_status_check
       CHECK (status IN ('planned','in_progress','completed','missed','cancelled'))
   )`,

  `CREATE TABLE IF NOT EXISTS sales_targets (
     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
     period_year     INTEGER NOT NULL,
     period_month    INTEGER NOT NULL,
     target_amount   NUMERIC(16,2) NOT NULL DEFAULT 0,
     CONSTRAINT sales_targets_month_check CHECK (period_month BETWEEN 1 AND 12),
     UNIQUE (tenant_id, user_id, period_year, period_month)
   )`,
];
