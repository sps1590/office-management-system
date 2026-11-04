// SRS 3.5 / 4.4 — Vehicle & Fleet Management.
// Registry, driver assignment, calendar booking with approval, trip logs
// (odometer + fuel), maintenance scheduling.

export const FLEET_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS vehicles (
     id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     registration_number TEXT NOT NULL,
     make                TEXT,
     model               TEXT,
     year                INTEGER,
     vehicle_type        TEXT NOT NULL DEFAULT 'car',
     fuel_type           TEXT NOT NULL DEFAULT 'petrol',
     seating_capacity    INTEGER,
     load_capacity_kg    NUMERIC(10,2),
     status              TEXT NOT NULL DEFAULT 'available',
     current_odometer    INTEGER NOT NULL DEFAULT 0,
     assigned_driver_id  UUID REFERENCES users(id) ON DELETE SET NULL,
     purchase_date       DATE,
     purchase_cost       NUMERIC(14,2),
     insurance_expiry    DATE,
     fitness_expiry      DATE,
     tax_token_expiry    DATE,
     notes               TEXT,
     created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT vehicles_status_check
       CHECK (status IN ('available','in_use','maintenance','retired')),
     CONSTRAINT vehicles_type_check
       CHECK (vehicle_type IN ('car','van','pickup','truck','bus','motorcycle','forklift','other')),
     CONSTRAINT vehicles_fuel_check
       CHECK (fuel_type IN ('petrol','diesel','octane','cng','lpg','electric','hybrid')),
     UNIQUE (tenant_id, registration_number)
   )`,

  // The requisition workflow from SRS 3.5: an employee books, the fleet
  // manager approves, the driver runs it. Calendar conflicts are rejected in
  // the action with an overlap query against this table.
  `CREATE TABLE IF NOT EXISTS vehicle_bookings (
     id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     vehicle_id       UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
     driver_id        UUID REFERENCES users(id) ON DELETE SET NULL,
     requested_by     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     purpose          TEXT NOT NULL,
     destination      TEXT,
     destination_lat  NUMERIC(10,7),
     destination_lng  NUMERIC(10,7),
     start_time       TIMESTAMPTZ NOT NULL,
     end_time         TIMESTAMPTZ NOT NULL,
     passengers       INTEGER NOT NULL DEFAULT 1,
     status           TEXT NOT NULL DEFAULT 'pending',
     approved_by      UUID REFERENCES users(id) ON DELETE SET NULL,
     approved_at      TIMESTAMPTZ,
     rejection_reason TEXT,
     created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT vehicle_bookings_status_check
       CHECK (status IN ('pending','approved','rejected','in_progress','completed','cancelled')),
     CONSTRAINT vehicle_bookings_time_order CHECK (end_time > start_time)
   )`,

  `CREATE TABLE IF NOT EXISTS trip_logs (
     id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     booking_id     UUID NOT NULL UNIQUE REFERENCES vehicle_bookings(id) ON DELETE CASCADE,
     vehicle_id     UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
     driver_id      UUID REFERENCES users(id) ON DELETE SET NULL,
     start_odometer INTEGER NOT NULL DEFAULT 0,
     end_odometer   INTEGER,
     distance_km    NUMERIC(10,2),
     fuel_litres    NUMERIC(10,2),
     fuel_cost      NUMERIC(12,2),
     toll_cost      NUMERIC(12,2),
     other_cost     NUMERIC(12,2),
     started_at     TIMESTAMPTZ,
     ended_at       TIMESTAMPTZ,
     notes          TEXT,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT trip_logs_odometer_order
       CHECK (end_odometer IS NULL OR end_odometer >= start_odometer)
   )`,

  `CREATE TABLE IF NOT EXISTS vehicle_maintenance (
     id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     vehicle_id         UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
     service_type       TEXT NOT NULL,
     description        TEXT,
     scheduled_date     DATE,
     completed_date     DATE,
     odometer           INTEGER,
     cost               NUMERIC(12,2) NOT NULL DEFAULT 0,
     vendor_id          UUID,
     status             TEXT NOT NULL DEFAULT 'scheduled',
     next_due_date      DATE,
     next_due_odometer  INTEGER,
     created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT vehicle_maintenance_status_check
       CHECK (status IN ('scheduled','in_progress','completed','cancelled'))
   )`,
];
