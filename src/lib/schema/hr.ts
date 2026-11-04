// SRS 3.4 — Human Resources & Leave Management.
// Employee profile detail, holidays, leave types/balances, multi-layer leave
// approvals, geo-fenced attendance with 8-hour and overtime computation,
// payroll runs and payslips.

export const HR_SCHEMA: string[] = [
  // Extends users rather than duplicating it: the employee directory IS the
  // user table (SRS 4.3), and this holds the HR-only columns so a query that
  // just needs a name never loads salary data.
  `CREATE TABLE IF NOT EXISTS employee_profiles (
     user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     date_of_joining         DATE,
     date_of_birth           DATE,
     gender                  TEXT,
     blood_group             TEXT,
     national_id             TEXT,
     marital_status          TEXT,
     present_address         TEXT,
     permanent_address       TEXT,
     emergency_contact_name  TEXT,
     emergency_contact_phone TEXT,
     employment_type         TEXT NOT NULL DEFAULT 'permanent',
     basic_salary            NUMERIC(14,2) NOT NULL DEFAULT 0,
     house_rent              NUMERIC(14,2) NOT NULL DEFAULT 0,
     medical_allowance       NUMERIC(14,2) NOT NULL DEFAULT 0,
     transport_allowance     NUMERIC(14,2) NOT NULL DEFAULT 0,
     other_allowance         NUMERIC(14,2) NOT NULL DEFAULT 0,
     bank_name               TEXT,
     bank_account            TEXT,
     tax_id                  TEXT,
     probation_end_date      DATE,
     contract_end_date       DATE,
     updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT employee_profiles_employment_type_check
       CHECK (employment_type IN ('permanent','contract','probation','intern','consultant'))
   )`,

  `CREATE TABLE IF NOT EXISTS holidays (
     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     holiday_date DATE NOT NULL,
     name         TEXT NOT NULL,
     is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
     created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (tenant_id, holiday_date)
   )`,

  `CREATE TABLE IF NOT EXISTS leave_types (
     id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     key               TEXT NOT NULL,
     name              TEXT NOT NULL,
     annual_quota      NUMERIC(6,1) NOT NULL DEFAULT 0,
     is_paid           BOOLEAN NOT NULL DEFAULT TRUE,
     requires_document BOOLEAN NOT NULL DEFAULT FALSE,
     color             TEXT NOT NULL DEFAULT '#6366f1',
     sort_order        INTEGER NOT NULL DEFAULT 0,
     is_active         BOOLEAN NOT NULL DEFAULT TRUE,
     UNIQUE (tenant_id, key)
   )`,

  `CREATE TABLE IF NOT EXISTS leave_balances (
     id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     leave_type_id    UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
     year             INTEGER NOT NULL,
     entitled         NUMERIC(6,1) NOT NULL DEFAULT 0,
     used             NUMERIC(6,1) NOT NULL DEFAULT 0,
     carried_forward  NUMERIC(6,1) NOT NULL DEFAULT 0,
     UNIQUE (tenant_id, user_id, leave_type_id, year)
   )`,

  // current_stage / total_stages drive the configurable chain from
  // tenant_settings.leave_approval_stages (SRS 3.4: Employee -> Line Manager
  // -> HR). One leave_approvals row is created per stage up front, so the
  // whole chain and its history are visible before anyone has acted.
  `CREATE TABLE IF NOT EXISTS leave_requests (
     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
     start_date    DATE NOT NULL,
     end_date      DATE NOT NULL,
     days          NUMERIC(6,1) NOT NULL,
     reason        TEXT,
     document_url  TEXT,
     status        TEXT NOT NULL DEFAULT 'pending',
     current_stage INTEGER NOT NULL DEFAULT 1,
     total_stages  INTEGER NOT NULL DEFAULT 1,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
     decided_at    TIMESTAMPTZ,
     CONSTRAINT leave_requests_status_check
       CHECK (status IN ('pending','approved','rejected','cancelled')),
     CONSTRAINT leave_requests_date_order CHECK (end_date >= start_date)
   )`,

  `CREATE TABLE IF NOT EXISTS leave_approvals (
     id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     leave_request_id UUID NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
     approver_id      UUID REFERENCES users(id) ON DELETE SET NULL,
     approver_role    TEXT,
     stage            INTEGER NOT NULL,
     decision         TEXT NOT NULL DEFAULT 'pending',
     comments         TEXT,
     decided_at       TIMESTAMPTZ,
     created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT leave_approvals_decision_check
       CHECK (decision IN ('pending','approved','rejected')),
     UNIQUE (leave_request_id, stage)
   )`,

  // One row per employee per day. worked_minutes / overtime_minutes /
  // late_minutes are computed on check-out from tenant_settings, so reports
  // never recompute a formula that may have changed since.
  `CREATE TABLE IF NOT EXISTS attendance_records (
     id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     work_date           DATE NOT NULL,
     check_in_at         TIMESTAMPTZ,
     check_out_at        TIMESTAMPTZ,
     check_in_lat        NUMERIC(10,7),
     check_in_lng        NUMERIC(10,7),
     check_out_lat       NUMERIC(10,7),
     check_out_lng       NUMERIC(10,7),
     check_in_accuracy   NUMERIC(8,2),
     geofence_id         UUID,
     inside_geofence     BOOLEAN,
     worked_minutes      INTEGER NOT NULL DEFAULT 0,
     overtime_minutes    INTEGER NOT NULL DEFAULT 0,
     late_minutes        INTEGER NOT NULL DEFAULT 0,
     status              TEXT NOT NULL DEFAULT 'present',
     source              TEXT NOT NULL DEFAULT 'web',
     note                TEXT,
     created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT attendance_records_status_check
       CHECK (status IN ('present','late','absent','half_day','on_leave','holiday','weekend')),
     CONSTRAINT attendance_records_source_check
       CHECK (source IN ('web','mobile','manual','import')),
     UNIQUE (tenant_id, user_id, work_date)
   )`,

  `CREATE TABLE IF NOT EXISTS payroll_runs (
     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     period_year     INTEGER NOT NULL,
     period_month    INTEGER NOT NULL,
     status          TEXT NOT NULL DEFAULT 'draft',
     gross_total     NUMERIC(16,2) NOT NULL DEFAULT 0,
     deduction_total NUMERIC(16,2) NOT NULL DEFAULT 0,
     net_total       NUMERIC(16,2) NOT NULL DEFAULT 0,
     processed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
     processed_at    TIMESTAMPTZ,
     paid_at         TIMESTAMPTZ,
     note            TEXT,
     created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT payroll_runs_status_check
       CHECK (status IN ('draft','approved','paid','cancelled')),
     CONSTRAINT payroll_runs_month_check CHECK (period_month BETWEEN 1 AND 12),
     UNIQUE (tenant_id, period_year, period_month)
   )`,

  `CREATE TABLE IF NOT EXISTS payslips (
     id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     payroll_run_id   UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
     user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     basic            NUMERIC(14,2) NOT NULL DEFAULT 0,
     allowances       NUMERIC(14,2) NOT NULL DEFAULT 0,
     overtime_minutes INTEGER NOT NULL DEFAULT 0,
     overtime_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
     bonus            NUMERIC(14,2) NOT NULL DEFAULT 0,
     gross            NUMERIC(14,2) NOT NULL DEFAULT 0,
     tax_deduction    NUMERIC(14,2) NOT NULL DEFAULT 0,
     other_deduction  NUMERIC(14,2) NOT NULL DEFAULT 0,
     net_pay          NUMERIC(14,2) NOT NULL DEFAULT 0,
     present_days     NUMERIC(5,1) NOT NULL DEFAULT 0,
     leave_days       NUMERIC(5,1) NOT NULL DEFAULT 0,
     absent_days      NUMERIC(5,1) NOT NULL DEFAULT 0,
     status           TEXT NOT NULL DEFAULT 'draft',
     paid_at          TIMESTAMPTZ,
     note             TEXT,
     CONSTRAINT payslips_status_check
       CHECK (status IN ('draft','approved','paid')),
     UNIQUE (payroll_run_id, user_id)
   )`,

  // payslips.status and paid_at were missing from the first deployed version
  // while the payroll queries and the approve/pay action both used them --
  // caught by the first run against a real database. Added here as well as in
  // the CREATE above, because a database created before this point already
  // exists and there is no migration runner.
  `ALTER TABLE payslips ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'`,
  `ALTER TABLE payslips ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`,
  `ALTER TABLE payslips DROP CONSTRAINT IF EXISTS payslips_status_check`,
  `ALTER TABLE payslips ADD CONSTRAINT payslips_status_check
     CHECK (status IN ('draft','approved','paid'))`,
];
