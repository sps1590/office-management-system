// Finance / Accounts (SRS section 1 and the Finance Manager role in 2):
// General Ledger as double-entry journal, Accounts Receivable (invoices),
// Accounts Payable (bills), payments, expense claim verification, budgets.

export const FINANCE_SCHEMA: string[] = [
  // Chart of accounts. `key` is a stable handle the auto-posting code looks
  // accounts up by (see src/lib/ledger.ts) so renaming an account or changing
  // its code never breaks posting.
  `CREATE TABLE IF NOT EXISTS accounts (
     id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     code       TEXT NOT NULL,
     key        TEXT,
     name       TEXT NOT NULL,
     type       TEXT NOT NULL,
     parent_id  UUID REFERENCES accounts(id) ON DELETE SET NULL,
     is_active  BOOLEAN NOT NULL DEFAULT TRUE,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT accounts_type_check
       CHECK (type IN ('asset','liability','equity','income','expense')),
     UNIQUE (tenant_id, code)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS accounts_tenant_key_idx
     ON accounts (tenant_id, key) WHERE key IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS journal_entries (
     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     entry_date  DATE NOT NULL DEFAULT CURRENT_DATE,
     description TEXT NOT NULL,
     source      TEXT NOT NULL DEFAULT 'manual',
     source_id   UUID,
     created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // Debits and credits are separate columns rather than one signed amount:
  // a trial balance then reads as two SUMs and an imbalance is obvious.
  `CREATE TABLE IF NOT EXISTS journal_lines (
     id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
     account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
     debit            NUMERIC(16,2) NOT NULL DEFAULT 0,
     credit           NUMERIC(16,2) NOT NULL DEFAULT 0,
     memo             TEXT,
     CONSTRAINT journal_lines_one_side
       CHECK (NOT (debit > 0 AND credit > 0))
   )`,

  `CREATE TABLE IF NOT EXISTS invoices (
     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     invoice_number  TEXT NOT NULL,
     client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
     deal_id         UUID REFERENCES deals(id) ON DELETE SET NULL,
     issue_date      DATE NOT NULL DEFAULT CURRENT_DATE,
     due_date        DATE,
     subtotal        NUMERIC(16,2) NOT NULL DEFAULT 0,
     tax_amount      NUMERIC(16,2) NOT NULL DEFAULT 0,
     discount_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
     total_amount    NUMERIC(16,2) NOT NULL DEFAULT 0,
     amount_paid     NUMERIC(16,2) NOT NULL DEFAULT 0,
     currency        TEXT NOT NULL DEFAULT 'BDT',
     status          TEXT NOT NULL DEFAULT 'draft',
     notes           TEXT,
     created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
     created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT invoices_status_check
       CHECK (status IN ('draft','sent','partially_paid','paid','overdue','void')),
     UNIQUE (tenant_id, invoice_number)
   )`,

  `CREATE TABLE IF NOT EXISTS invoice_items (
     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
     description TEXT NOT NULL,
     quantity    NUMERIC(14,3) NOT NULL DEFAULT 1,
     unit_price  NUMERIC(14,2) NOT NULL DEFAULT 0,
     line_total  NUMERIC(16,2) NOT NULL DEFAULT 0,
     sort_order  INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE IF NOT EXISTS bills (
     id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     bill_number       TEXT NOT NULL,
     vendor_id         UUID REFERENCES vendors(id) ON DELETE SET NULL,
     purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
     issue_date        DATE NOT NULL DEFAULT CURRENT_DATE,
     due_date          DATE,
     subtotal          NUMERIC(16,2) NOT NULL DEFAULT 0,
     tax_amount        NUMERIC(16,2) NOT NULL DEFAULT 0,
     total_amount      NUMERIC(16,2) NOT NULL DEFAULT 0,
     amount_paid       NUMERIC(16,2) NOT NULL DEFAULT 0,
     status            TEXT NOT NULL DEFAULT 'pending',
     notes             TEXT,
     created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT bills_status_check
       CHECK (status IN ('draft','pending','partially_paid','paid','overdue','void')),
     UNIQUE (tenant_id, bill_number)
   )`,

  // One table for money in and money out, so a cash-flow report is a single
  // scan with a GROUP BY on direction.
  `CREATE TABLE IF NOT EXISTS payments (
     id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     direction  TEXT NOT NULL,
     invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
     bill_id    UUID REFERENCES bills(id) ON DELETE SET NULL,
     amount     NUMERIC(16,2) NOT NULL,
     method     TEXT NOT NULL DEFAULT 'bank',
     paid_on    DATE NOT NULL DEFAULT CURRENT_DATE,
     reference  TEXT,
     note       TEXT,
     created_by UUID REFERENCES users(id) ON DELETE SET NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT payments_direction_check CHECK (direction IN ('in','out')),
     CONSTRAINT payments_method_check
       CHECK (method IN ('cash','bank','cheque','mobile','card','other'))
   )`,

  `CREATE TABLE IF NOT EXISTS expense_claims (
     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     claim_number  TEXT,
     category      TEXT NOT NULL DEFAULT 'other',
     amount        NUMERIC(14,2) NOT NULL,
     expense_date  DATE NOT NULL DEFAULT CURRENT_DATE,
     description   TEXT,
     receipt_url   TEXT,
     latitude      NUMERIC(10,7),
     longitude     NUMERIC(10,7),
     status        TEXT NOT NULL DEFAULT 'pending',
     approver_id   UUID REFERENCES users(id) ON DELETE SET NULL,
     comments      TEXT,
     decided_at    TIMESTAMPTZ,
     reimbursed_on DATE,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT expense_claims_status_check
       CHECK (status IN ('pending','approved','rejected','reimbursed'))
   )`,

  `CREATE TABLE IF NOT EXISTS budgets (
     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     account_id    UUID REFERENCES accounts(id) ON DELETE CASCADE,
     department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
     period_year   INTEGER NOT NULL,
     period_month  INTEGER,
     amount        NUMERIC(16,2) NOT NULL DEFAULT 0,
     note          TEXT,
     UNIQUE (tenant_id, account_id, department_id, period_year, period_month)
   )`,
];
