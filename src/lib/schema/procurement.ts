// SRS 3.3 / 4.2 — Procurement & Supply Chain Management.
// Vendors with ratings and price history, warehouses, inventory with reorder
// levels, stock movements with batch tracking, purchase orders with
// multi-tier financial approval, and logistics routes that tie a delivery to
// a vehicle and to the GPS engine.

export const PROCUREMENT_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS warehouses (
     id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     name       TEXT NOT NULL,
     code       TEXT,
     address    TEXT,
     latitude   NUMERIC(10,7),
     longitude  NUMERIC(10,7),
     manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
     is_active  BOOLEAN NOT NULL DEFAULT TRUE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (tenant_id, name)
   )`,

  `CREATE TABLE IF NOT EXISTS vendors (
     id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     company_name   TEXT NOT NULL,
     vendor_code    TEXT,
     contact_person TEXT,
     email          TEXT,
     phone          TEXT,
     address        TEXT,
     category       TEXT,
     rating         NUMERIC(2,1) NOT NULL DEFAULT 0,
     payment_terms  TEXT,
     tax_id         TEXT,
     bank_details   TEXT,
     status         TEXT NOT NULL DEFAULT 'active',
     notes          TEXT,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT vendors_status_check
       CHECK (status IN ('active','inactive','blacklisted')),
     CONSTRAINT vendors_rating_check CHECK (rating >= 0 AND rating <= 5)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vendors_tenant_code_idx
     ON vendors (tenant_id, vendor_code) WHERE vendor_code IS NOT NULL`,

  // vehicle_maintenance.vendor_id was declared without a constraint because
  // fleet tables are created before vendors exists. Wire it up now.
  `ALTER TABLE vehicle_maintenance DROP CONSTRAINT IF EXISTS vehicle_maintenance_vendor_fk`,
  `ALTER TABLE vehicle_maintenance ADD CONSTRAINT vehicle_maintenance_vendor_fk
     FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL`,

  `CREATE TABLE IF NOT EXISTS inventory_items (
     id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     sku              TEXT NOT NULL,
     item_name        TEXT NOT NULL,
     description      TEXT,
     category         TEXT,
     unit             TEXT NOT NULL DEFAULT 'pcs',
     current_stock    NUMERIC(14,3) NOT NULL DEFAULT 0,
     reorder_level    NUMERIC(14,3) NOT NULL DEFAULT 0,
     reorder_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
     unit_cost        NUMERIC(14,2) NOT NULL DEFAULT 0,
     warehouse_id     UUID REFERENCES warehouses(id) ON DELETE SET NULL,
     bin_location     TEXT,
     is_active        BOOLEAN NOT NULL DEFAULT TRUE,
     created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (tenant_id, sku)
   )`,

  // Append-only ledger of stock. inventory_items.current_stock is the
  // running cache; this table is the audit trail that explains it, with the
  // batch_number / expiry_date the SRS asks for under batch tracking.
  `CREATE TABLE IF NOT EXISTS stock_movements (
     id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
     warehouse_id      UUID REFERENCES warehouses(id) ON DELETE SET NULL,
     movement_type     TEXT NOT NULL,
     quantity          NUMERIC(14,3) NOT NULL,
     unit_cost         NUMERIC(14,2),
     reference_type    TEXT,
     reference_id      UUID,
     batch_number      TEXT,
     expiry_date       DATE,
     note              TEXT,
     created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
     created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT stock_movements_type_check
       CHECK (movement_type IN ('in','out','adjustment','transfer'))
   )`,

  // current_tier / total_tiers implement the "multi-tier financial approval
  // workflow" of SRS 3.3, driven by tenant_settings.po_approval_tiers: a
  // threshold list such as [{amount: 50000, role: "finance_manager"}].
  `CREATE TABLE IF NOT EXISTS purchase_orders (
     id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     po_number      TEXT NOT NULL,
     vendor_id      UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
     warehouse_id   UUID REFERENCES warehouses(id) ON DELETE SET NULL,
     requested_by   UUID REFERENCES users(id) ON DELETE SET NULL,
     order_date     DATE NOT NULL DEFAULT CURRENT_DATE,
     expected_date  DATE,
     received_date  DATE,
     subtotal       NUMERIC(16,2) NOT NULL DEFAULT 0,
     tax_amount     NUMERIC(16,2) NOT NULL DEFAULT 0,
     shipping_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
     total_amount   NUMERIC(16,2) NOT NULL DEFAULT 0,
     currency       TEXT NOT NULL DEFAULT 'BDT',
     status         TEXT NOT NULL DEFAULT 'draft',
     current_tier   INTEGER NOT NULL DEFAULT 1,
     total_tiers    INTEGER NOT NULL DEFAULT 1,
     terms          TEXT,
     notes          TEXT,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT purchase_orders_status_check
       CHECK (status IN ('draft','pending','approved','rejected','partially_received','received','cancelled')),
     UNIQUE (tenant_id, po_number)
   )`,

  `CREATE TABLE IF NOT EXISTS purchase_order_items (
     id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
     inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
     description       TEXT NOT NULL,
     quantity          NUMERIC(14,3) NOT NULL DEFAULT 1,
     received_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
     unit_price        NUMERIC(14,2) NOT NULL DEFAULT 0,
     line_total        NUMERIC(16,2) NOT NULL DEFAULT 0,
     sort_order        INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE IF NOT EXISTS po_approvals (
     id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
     approver_id       UUID REFERENCES users(id) ON DELETE SET NULL,
     approver_role     TEXT,
     tier              INTEGER NOT NULL,
     threshold_amount  NUMERIC(16,2),
     decision          TEXT NOT NULL DEFAULT 'pending',
     comments          TEXT,
     decided_at        TIMESTAMPTZ,
     created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT po_approvals_decision_check
       CHECK (decision IN ('pending','approved','rejected')),
     UNIQUE (purchase_order_id, tier)
   )`,

  // "Historical pricing" from SRS 3.3: one row per item per receipt, so the
  // buyer can see whether a quoted price is better or worse than last time.
  `CREATE TABLE IF NOT EXISTS vendor_price_history (
     id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     vendor_id         UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
     inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE,
     description       TEXT,
     unit_price        NUMERIC(14,2) NOT NULL,
     purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
     recorded_on       DATE NOT NULL DEFAULT CURRENT_DATE
   )`,

  // SRS 4.2 logistics_routes: id, po_id, assigned_vehicle_id,
  // route_waypoints JSONB -- plus the live-tracking columns the MIS map needs.
  `CREATE TABLE IF NOT EXISTS logistics_routes (
     id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     purchase_order_id  UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
     assigned_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
     driver_id          UUID REFERENCES users(id) ON DELETE SET NULL,
     origin_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
     reference          TEXT,
     destination        TEXT,
     destination_lat    NUMERIC(10,7),
     destination_lng    NUMERIC(10,7),
     route_waypoints    JSONB NOT NULL DEFAULT '[]'::jsonb,
     planned_departure  TIMESTAMPTZ,
     planned_arrival    TIMESTAMPTZ,
     actual_departure   TIMESTAMPTZ,
     actual_arrival     TIMESTAMPTZ,
     distance_km        NUMERIC(10,2),
     status             TEXT NOT NULL DEFAULT 'planned',
     notes              TEXT,
     created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT logistics_routes_status_check
       CHECK (status IN ('planned','in_transit','delivered','delayed','cancelled'))
   )`,
];
