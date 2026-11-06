import "server-only";
import { getDb } from "./db";
import { addDays, calendarBounds } from "./utils";

export type Vehicle = {
  id: string;
  registration_number: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vehicle_type: string;
  fuel_type: string;
  seating_capacity: number | null;
  status: string;
  current_odometer: number;
  assigned_driver_id: string | null;
  driver_name: string | null;
  insurance_expiry: string | null;
  fitness_expiry: string | null;
  tax_token_expiry: string | null;
  notes: string | null;
  open_bookings: number;
};

export type Booking = {
  id: string;
  vehicle_id: string;
  registration_number: string;
  driver_id: string | null;
  driver_name: string | null;
  requested_by: string;
  requester_name: string;
  purpose: string;
  destination: string | null;
  start_time: string;
  end_time: string;
  passengers: number;
  status: string;
  approved_by_name: string | null;
  rejection_reason: string | null;
  trip_id: string | null;
  start_odometer: number | null;
  end_odometer: number | null;
  distance_km: number | null;
  fuel_cost: number | null;
};

export async function listVehicles(
  tenantId: string,
  filters: { q?: string; status?: string; type?: string } = {}
): Promise<Vehicle[]> {
  const db = await getDb();
  const q = filters.q?.trim() ? `%${filters.q.trim()}%` : null;
  const rows = await db`
    SELECT v.*, d.full_name AS driver_name,
           (SELECT COUNT(*)::int FROM vehicle_bookings b
             WHERE b.vehicle_id = v.id AND b.tenant_id = ${tenantId}
               AND b.status IN ('pending','approved','in_progress')) AS open_bookings
      FROM vehicles v
      LEFT JOIN users d ON d.id = v.assigned_driver_id
     WHERE v.tenant_id = ${tenantId}
       AND (${q}::text IS NULL OR v.registration_number ILIKE ${q}
            OR v.make ILIKE ${q} OR v.model ILIKE ${q})
       AND (${filters.status ?? null}::text IS NULL OR v.status = ${filters.status ?? null})
       AND (${filters.type ?? null}::text IS NULL OR v.vehicle_type = ${filters.type ?? null})
     ORDER BY v.registration_number
  `;
  return rows as unknown as Vehicle[];
}

export async function fleetStats(tenantId: string, timeZone: string) {
  const db = await getDb();
  const soon = addDays(calendarBounds(timeZone).today, 30);
  const rows = await db`
    SELECT COUNT(*)::int                                            AS total,
           COUNT(*) FILTER (WHERE status = 'available')::int         AS available,
           COUNT(*) FILTER (WHERE status = 'in_use')::int            AS in_use,
           COUNT(*) FILTER (WHERE status = 'maintenance')::int       AS maintenance,
           COUNT(*) FILTER (WHERE insurance_expiry IS NOT NULL
                              AND insurance_expiry < ${soon}::date)::int AS insurance_due,
           COUNT(*) FILTER (WHERE fitness_expiry IS NOT NULL
                              AND fitness_expiry < ${soon}::date)::int   AS fitness_due,
           COALESCE(SUM(current_odometer), 0)::int                   AS total_odometer
      FROM vehicles WHERE tenant_id = ${tenantId}
  `;
  return rows[0] as {
    total: number;
    available: number;
    in_use: number;
    maintenance: number;
    insurance_due: number;
    fitness_due: number;
    total_odometer: number;
  };
}

export async function listBookings(
  tenantId: string,
  filters: { status?: string; userId?: string; vehicleId?: string } = {}
): Promise<Booking[]> {
  const db = await getDb();
  const rows = await db`
    SELECT b.*, v.registration_number,
           d.full_name AS driver_name,
           rq.full_name AS requester_name,
           ap.full_name AS approved_by_name,
           t.id AS trip_id, t.start_odometer, t.end_odometer,
           t.distance_km::float AS distance_km, t.fuel_cost::float AS fuel_cost
      FROM vehicle_bookings b
      JOIN vehicles v   ON v.id = b.vehicle_id
      JOIN users rq     ON rq.id = b.requested_by
      LEFT JOIN users d  ON d.id = b.driver_id
      LEFT JOIN users ap ON ap.id = b.approved_by
      LEFT JOIN trip_logs t ON t.booking_id = b.id
     WHERE b.tenant_id = ${tenantId}
       AND (${filters.status ?? null}::text IS NULL OR b.status = ${filters.status ?? null})
       AND (${filters.userId ?? null}::uuid IS NULL OR b.requested_by = ${filters.userId ?? null}::uuid
            OR b.driver_id = ${filters.userId ?? null}::uuid)
       AND (${filters.vehicleId ?? null}::uuid IS NULL OR b.vehicle_id = ${filters.vehicleId ?? null}::uuid)
     ORDER BY b.start_time DESC
     LIMIT 200
  `;
  return rows as unknown as Booking[];
}

export async function bookingStats(tenantId: string, timeZone: string) {
  const db = await getDb();
  const cal = calendarBounds(timeZone);
  const rows = await db`
    SELECT COUNT(*) FILTER (WHERE status = 'pending')::int      AS pending,
           COUNT(*) FILTER (WHERE status = 'approved')::int      AS approved,
           COUNT(*) FILTER (WHERE status = 'in_progress')::int   AS in_progress,
           COUNT(*) FILTER (WHERE status = 'completed'
             AND start_time >= ${cal.monthStartAt})::int AS completed_this_month
      FROM vehicle_bookings WHERE tenant_id = ${tenantId}
  `;
  return rows[0] as {
    pending: number;
    approved: number;
    in_progress: number;
    completed_this_month: number;
  };
}

export async function listMaintenance(tenantId: string, filters: { status?: string } = {}) {
  const db = await getDb();
  const rows = await db`
    SELECT m.*, v.registration_number, ven.company_name AS vendor_name,
           m.cost::float AS cost
      FROM vehicle_maintenance m
      JOIN vehicles v       ON v.id = m.vehicle_id
      LEFT JOIN vendors ven ON ven.id = m.vendor_id
     WHERE m.tenant_id = ${tenantId}
       AND (${filters.status ?? null}::text IS NULL OR m.status = ${filters.status ?? null})
     ORDER BY (m.status = 'completed'),
              COALESCE(m.scheduled_date, m.completed_date) DESC
     LIMIT 200
  `;
  return rows as unknown as {
    id: string;
    vehicle_id: string;
    registration_number: string;
    service_type: string;
    description: string | null;
    scheduled_date: string | null;
    completed_date: string | null;
    odometer: number | null;
    cost: number;
    vendor_name: string | null;
    status: string;
    next_due_date: string | null;
    next_due_odometer: number | null;
  }[];
}

/** Monthly fuel and maintenance spend, for the fleet cost chart. */
export async function fleetCostTrend(tenantId: string, timeZone: string) {
  const db = await getDb();
  const cal = calendarBounds(timeZone);
  const rows = await db`
    SELECT to_char(m.month, 'Mon') AS label,
           COALESCE((
             SELECT SUM(t.fuel_cost + COALESCE(t.toll_cost,0) + COALESCE(t.other_cost,0))
               FROM trip_logs t
              WHERE t.tenant_id = ${tenantId}
                AND date_trunc('month', timezone(${timeZone}, t.started_at)) = m.month
           ), 0)::float AS trips,
           COALESCE((
             SELECT SUM(vm.cost) FROM vehicle_maintenance vm
              WHERE vm.tenant_id = ${tenantId}
                AND date_trunc('month', vm.completed_date) = m.month
           ), 0)::float AS maintenance
      FROM generate_series(${cal.monthStart}::timestamp - INTERVAL '5 months',
                           ${cal.monthStart}::timestamp, '1 month') AS m(month)
     ORDER BY m.month
  `;
  return rows as unknown as { label: string; trips: number; maintenance: number }[];
}

/** Drivers available to assign — users holding the driver role. */
export async function listDrivers(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT u.id, u.full_name FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.tenant_id = ${tenantId} AND u.status = 'active'
       AND (r.key = 'driver' OR r.key IS NULL OR r.key = 'fleet_manager')
     ORDER BY (r.key = 'driver') DESC, u.full_name
  `;
  return rows as unknown as { id: string; full_name: string }[];
}
