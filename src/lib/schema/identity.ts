// Core identity: roles with their permission matrix, departments, users,
// sessions, rate limiting, audit trail, notifications.
//
// SRS section 4.3 names tenants / roles / users with role_id and
// line_manager_id; those are all present, plus the operational columns an
// employee directory actually needs.

export const IDENTITY_SCHEMA: string[] = [
  // tenant_id IS NULL marks a *system role template* — the ten roles from SRS
  // section 2, copied into a tenant at signup so each company can then edit
  // its own matrix without affecting anyone else.
  `CREATE TABLE IF NOT EXISTS roles (
     id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id          UUID REFERENCES tenants(id) ON DELETE CASCADE,
     key                TEXT NOT NULL,
     role_name          TEXT NOT NULL,
     description        TEXT,
     permissions_matrix JSONB NOT NULL DEFAULT '{}'::jsonb,
     is_system          BOOLEAN NOT NULL DEFAULT FALSE,
     sort_order         INTEGER NOT NULL DEFAULT 0,
     created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS roles_tenant_key_idx
     ON roles (tenant_id, key) WHERE tenant_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS roles_system_key_idx
     ON roles (key) WHERE tenant_id IS NULL`,

  // head_user_id has no inline FK because users references departments and
  // departments references users -- the constraint is added after both tables
  // exist, further down this list.
  `CREATE TABLE IF NOT EXISTS departments (
     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     name         TEXT NOT NULL,
     code         TEXT,
     head_user_id UUID,
     parent_id    UUID REFERENCES departments(id) ON DELETE SET NULL,
     created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // email is globally unique: login takes an email with no tenant hint, so
  // one address cannot belong to two companies.
  `CREATE TABLE IF NOT EXISTS users (
     id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     role_id           UUID REFERENCES roles(id) ON DELETE SET NULL,
     line_manager_id   UUID REFERENCES users(id) ON DELETE SET NULL,
     department_id     UUID REFERENCES departments(id) ON DELETE SET NULL,
     full_name         TEXT NOT NULL,
     email             TEXT NOT NULL UNIQUE,
     phone             TEXT,
     password_hash     TEXT NOT NULL,
     employee_code     TEXT,
     designation       TEXT,
     status            TEXT NOT NULL DEFAULT 'active',
     avatar_url        TEXT,
     locale            TEXT NOT NULL DEFAULT 'en',
     theme             TEXT NOT NULL DEFAULT 'system',
     is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
     last_login_at     TIMESTAMPTZ,
     created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT users_status_check
       CHECK (status IN ('active','invited','suspended','left'))
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_employee_code_idx
     ON users (tenant_id, employee_code) WHERE employee_code IS NOT NULL`,

  // Deferred FK for the departments <-> users cycle. DROP-then-ADD keeps the
  // statement idempotent, since Postgres has no ADD CONSTRAINT IF NOT EXISTS.
  `ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_head_user_fk`,
  `ALTER TABLE departments ADD CONSTRAINT departments_head_user_fk
     FOREIGN KEY (head_user_id) REFERENCES users(id) ON DELETE SET NULL`,

  `CREATE TABLE IF NOT EXISTS sessions (
     id         UUID PRIMARY KEY,
     user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     expires_at TIMESTAMPTZ NOT NULL,
     ip         TEXT,
     user_agent TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // Forgotten-password links. Only the SHA-256 of the token is kept, the way
  // device tokens are: a dump of this table hands an attacker nothing, since
  // the only value that opens a link was in one email and is nowhere else.
  `CREATE TABLE IF NOT EXISTS password_resets (
     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     token_hash   TEXT NOT NULL UNIQUE,
     expires_at   TIMESTAMPTZ NOT NULL,
     used_at      TIMESTAMPTZ,
     requested_ip TEXT,
     created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE INDEX IF NOT EXISTS password_resets_user_idx
     ON password_resets (user_id, expires_at DESC)`,

  // Generic fixed-window counter. Buckets are opaque strings such as
  // "login:someone@example.com" or "telemetry:<device uuid>", so one table
  // serves auth throttling and telemetry ingest throttling alike.
  `CREATE TABLE IF NOT EXISTS rate_limits (
     bucket       TEXT NOT NULL,
     window_start TIMESTAMPTZ NOT NULL,
     hits         INTEGER NOT NULL DEFAULT 1,
     PRIMARY KEY (bucket, window_start)
   )`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
     id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
     user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
     action     TEXT NOT NULL,
     entity     TEXT,
     entity_id  UUID,
     summary    TEXT,
     meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
     ip         TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS notifications (
     id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     title      TEXT NOT NULL,
     body       TEXT,
     kind       TEXT NOT NULL DEFAULT 'info',
     severity   TEXT NOT NULL DEFAULT 'normal',
     link       TEXT,
     entity     TEXT,
     entity_id  UUID,
     read_at    TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT notifications_severity_check
       CHECK (severity IN ('low','normal','high','critical'))
   )`,
];
