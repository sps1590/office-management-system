// Facilities Administration and Task Execution (both named in SRS section 1).
// Meeting rooms and bookings, the office asset register with an assignment
// history, the visitor log, and projects / tasks / comments where completing
// a task stamps GPS coordinates as proof of presence (SRS 3.2).

export const WORKPLACE_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS rooms (
     id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     name       TEXT NOT NULL,
     code       TEXT,
     floor      TEXT,
     capacity   INTEGER NOT NULL DEFAULT 0,
     amenities  JSONB NOT NULL DEFAULT '[]'::jsonb,
     status     TEXT NOT NULL DEFAULT 'available',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT rooms_status_check
       CHECK (status IN ('available','maintenance','retired')),
     UNIQUE (tenant_id, name)
   )`,

  `CREATE TABLE IF NOT EXISTS room_bookings (
     id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     room_id        UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
     booked_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     title          TEXT NOT NULL,
     purpose        TEXT,
     start_time     TIMESTAMPTZ NOT NULL,
     end_time       TIMESTAMPTZ NOT NULL,
     attendee_count INTEGER NOT NULL DEFAULT 1,
     status         TEXT NOT NULL DEFAULT 'confirmed',
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT room_bookings_status_check
       CHECK (status IN ('confirmed','cancelled','completed')),
     CONSTRAINT room_bookings_time_order CHECK (end_time > start_time)
   )`,

  `CREATE TABLE IF NOT EXISTS assets (
     id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     asset_tag        TEXT NOT NULL,
     name             TEXT NOT NULL,
     category         TEXT,
     serial_number    TEXT,
     assigned_to      UUID REFERENCES users(id) ON DELETE SET NULL,
     department_id    UUID REFERENCES departments(id) ON DELETE SET NULL,
     purchase_date    DATE,
     purchase_cost    NUMERIC(14,2),
     current_value    NUMERIC(14,2),
     warranty_expiry  DATE,
     condition        TEXT NOT NULL DEFAULT 'good',
     status           TEXT NOT NULL DEFAULT 'in_use',
     location         TEXT,
     notes            TEXT,
     created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT assets_condition_check
       CHECK (condition IN ('new','good','fair','poor','damaged')),
     CONSTRAINT assets_status_check
       CHECK (status IN ('in_use','in_store','under_repair','disposed','lost')),
     UNIQUE (tenant_id, asset_tag)
   )`,

  `CREATE TABLE IF NOT EXISTS asset_assignments (
     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     asset_id    UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
     user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
     assigned_on DATE NOT NULL DEFAULT CURRENT_DATE,
     returned_on DATE,
     note        TEXT,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS visitors (
     id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     full_name      TEXT NOT NULL,
     company        TEXT,
     phone          TEXT,
     email          TEXT,
     host_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
     purpose        TEXT,
     badge_number   TEXT,
     vehicle_number TEXT,
     checked_in_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
     checked_out_at TIMESTAMPTZ,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS projects (
     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     name          TEXT NOT NULL,
     code          TEXT,
     description   TEXT,
     owner_id      UUID REFERENCES users(id) ON DELETE SET NULL,
     department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
     status        TEXT NOT NULL DEFAULT 'active',
     start_date    DATE,
     end_date      DATE,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT projects_status_check
       CHECK (status IN ('planning','active','on_hold','completed','cancelled'))
   )`,

  // completed_lat / completed_lng are the "Proof of Presence" of SRS 3.2:
  // marking a task complete records where the device was at that moment.
  `CREATE TABLE IF NOT EXISTS tasks (
     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
     title           TEXT NOT NULL,
     description     TEXT,
     assigned_to     UUID REFERENCES users(id) ON DELETE SET NULL,
     created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
     priority        TEXT NOT NULL DEFAULT 'medium',
     status          TEXT NOT NULL DEFAULT 'todo',
     due_date        DATE,
     started_at      TIMESTAMPTZ,
     completed_at    TIMESTAMPTZ,
     completed_lat   NUMERIC(10,7),
     completed_lng   NUMERIC(10,7),
     estimated_hours NUMERIC(8,2),
     actual_hours    NUMERIC(8,2),
     related_type    TEXT,
     related_id      UUID,
     created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT tasks_priority_check
       CHECK (priority IN ('low','medium','high','urgent')),
     CONSTRAINT tasks_status_check
       CHECK (status IN ('todo','in_progress','review','done','cancelled'))
   )`,

  `CREATE TABLE IF NOT EXISTS task_comments (
     id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
     body       TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
];
