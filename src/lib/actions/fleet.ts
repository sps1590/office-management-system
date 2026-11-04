"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { postJournal } from "@/lib/ledger";
import { audit, notify, notifyRoles } from "@/lib/audit";
import { isoDate } from "@/lib/utils";
import type { ActionState } from "@/lib/types";

const nullable = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

const nullableDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

const nullableUuid = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || /^[0-9a-f-]{36}$/i.test(v), "Invalid selection");

/* --- vehicles ------------------------------------------------------------- */

const vehicleSchema = z.object({
  registrationNumber: z.string().trim().min(2, "Registration is required").max(32),
  make: nullable(60),
  model: nullable(60),
  year: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .nullable()
    .refine((v) => v === null || (v >= 1950 && v <= 2100), "Enter a valid year"),
  vehicleType: z.enum([
    "car",
    "van",
    "pickup",
    "truck",
    "bus",
    "motorcycle",
    "forklift",
    "other",
  ]),
  fuelType: z.enum(["petrol", "diesel", "octane", "cng", "lpg", "electric", "hybrid"]),
  seatingCapacity: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .nullable(),
  currentOdometer: z.coerce.number().int().min(0).max(10_000_000).default(0),
  assignedDriverId: nullableUuid,
  insuranceExpiry: nullableDate,
  fitnessExpiry: nullableDate,
  taxTokenExpiry: nullableDate,
  notes: nullable(600),
});

export async function createVehicleAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("fleet", "create");
  const parsed = vehicleSchema.safeParse({
    registrationNumber: formData.get("registrationNumber") ?? "",
    make: formData.get("make") ?? "",
    model: formData.get("model") ?? "",
    year: formData.get("year") ?? "",
    vehicleType: formData.get("vehicleType") || "car",
    fuelType: formData.get("fuelType") || "diesel",
    seatingCapacity: formData.get("seatingCapacity") ?? "",
    currentOdometer: formData.get("currentOdometer") || 0,
    assignedDriverId: formData.get("assignedDriverId") ?? "",
    insuranceExpiry: formData.get("insuranceExpiry") ?? "",
    fitnessExpiry: formData.get("fitnessExpiry") ?? "",
    taxTokenExpiry: formData.get("taxTokenExpiry") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const clash = await db`
    SELECT 1 FROM vehicles
     WHERE tenant_id = ${user.tenant_id} AND registration_number = ${d.registrationNumber}
  `;
  if (clash.length > 0) {
    return { fieldErrors: { registrationNumber: ["That vehicle is already registered."] } };
  }
  if (d.assignedDriverId) {
    const owned = await db`
      SELECT 1 FROM users WHERE id = ${d.assignedDriverId} AND tenant_id = ${user.tenant_id}
    `;
    if (owned.length === 0) return { error: "Invalid driver." };
  }

  await db`
    INSERT INTO vehicles (tenant_id, registration_number, make, model, year, vehicle_type,
                          fuel_type, seating_capacity, current_odometer, assigned_driver_id,
                          insurance_expiry, fitness_expiry, tax_token_expiry, notes, status)
    VALUES (${user.tenant_id}, ${d.registrationNumber}, ${d.make}, ${d.model}, ${d.year},
            ${d.vehicleType}, ${d.fuelType}, ${d.seatingCapacity}, ${d.currentOdometer},
            ${d.assignedDriverId}, ${d.insuranceExpiry}, ${d.fitnessExpiry},
            ${d.taxTokenExpiry}, ${d.notes}, 'available')
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "vehicle.created",
    entity: "vehicle",
    summary: `Added vehicle ${d.registrationNumber}`,
  });
  revalidatePath("/fleet");
  return { success: `${d.registrationNumber} added to the fleet.` };
}

export async function setVehicleStatusAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("fleet", "edit");
  const parsed = z
    .object({
      vehicleId: z.string().uuid(),
      status: z.enum(["available", "in_use", "maintenance", "retired"]),
    })
    .safeParse({
      vehicleId: formData.get("vehicleId"),
      status: formData.get("status"),
    });
  if (!parsed.success) return { error: "Invalid request." };
  const db = await getDb();

  const updated = await db`
    UPDATE vehicles SET status = ${parsed.data.status}
     WHERE id = ${parsed.data.vehicleId} AND tenant_id = ${user.tenant_id}
    RETURNING registration_number
  `;
  if (updated.length === 0) return { error: "Vehicle not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "vehicle.status_changed",
    entity: "vehicle",
    entityId: parsed.data.vehicleId,
    summary: `${(updated[0] as { registration_number: string }).registration_number} set to ${parsed.data.status}`,
  });
  revalidatePath("/fleet");
  return { success: "Vehicle status updated." };
}

/* --- requisition (booking) ------------------------------------------------ */

const bookingSchema = z
  .object({
    vehicleId: z.string().uuid("Choose a vehicle"),
    driverId: nullableUuid,
    purpose: z.string().trim().min(3, "Say what the trip is for").max(200),
    destination: nullable(200),
    startTime: z.string().min(10, "Pick a start time"),
    endTime: z.string().min(10, "Pick an end time"),
    passengers: z.coerce.number().int().min(1).max(200).default(1),
  })
  .refine((v) => new Date(v.endTime) > new Date(v.startTime), {
    message: "The return time must be after the departure time",
    path: ["endTime"],
  });

/**
 * Anyone may request a vehicle; the fleet manager approves (SRS 3.5).
 * Overlapping live bookings for the same vehicle are refused here rather than
 * discovered on the day.
 */
export async function createBookingAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  if (!hasPermission(user, "fleet", "create")) {
    return { error: "You do not have permission to request a vehicle." };
  }
  const parsed = bookingSchema.safeParse({
    vehicleId: formData.get("vehicleId"),
    driverId: formData.get("driverId") ?? "",
    purpose: formData.get("purpose") ?? "",
    destination: formData.get("destination") ?? "",
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    passengers: formData.get("passengers") || 1,
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const vehicle = await db`
    SELECT registration_number, status FROM vehicles
     WHERE id = ${d.vehicleId} AND tenant_id = ${user.tenant_id}
  `;
  const v = vehicle[0] as { registration_number: string; status: string } | undefined;
  if (!v) return { error: "Vehicle not found." };
  if (v.status === "retired") return { error: "That vehicle is retired." };

  const overlap = await db`
    SELECT 1 FROM vehicle_bookings
     WHERE tenant_id = ${user.tenant_id} AND vehicle_id = ${d.vehicleId}
       AND status IN ('pending','approved','in_progress')
       AND start_time < ${d.endTime} AND end_time > ${d.startTime}
  `;
  if (overlap.length > 0) {
    return {
      error: `${v.registration_number} is already booked for part of that period. Pick another vehicle or time.`,
    };
  }

  const inserted = await db`
    INSERT INTO vehicle_bookings (tenant_id, vehicle_id, driver_id, requested_by, purpose,
                                  destination, start_time, end_time, passengers, status)
    VALUES (${user.tenant_id}, ${d.vehicleId}, ${d.driverId}, ${user.id}, ${d.purpose},
            ${d.destination}, ${d.startTime}, ${d.endTime}, ${d.passengers}, 'pending')
    RETURNING id
  `;
  const bookingId = (inserted[0] as { id: string }).id;

  await notifyRoles(user.tenant_id, ["fleet_manager", "company_admin"], {
    title: "Vehicle requisition to approve",
    body: `${user.full_name} requested ${v.registration_number} — ${d.purpose}.`,
    kind: "approval",
    severity: "high",
    link: "/fleet/bookings",
    entity: "vehicle_booking",
    entityId: bookingId,
  });
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "booking.requested",
    entity: "vehicle_booking",
    entityId: bookingId,
    summary: `Requested ${v.registration_number} — ${d.purpose}`,
  });

  revalidatePath("/fleet/bookings");
  return { success: "Requisition submitted for approval." };
}

export async function decideBookingAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("fleet", "approve");
  const parsed = z
    .object({
      bookingId: z.string().uuid(),
      decision: z.enum(["approved", "rejected"]),
      reason: nullable(300),
    })
    .safeParse({
      bookingId: formData.get("bookingId"),
      decision: formData.get("decision"),
      reason: formData.get("reason") ?? "",
    });
  if (!parsed.success) return { error: "Invalid request." };
  const { bookingId, decision, reason } = parsed.data;
  const db = await getDb();

  const rows = await db`
    SELECT b.id, b.status, b.requested_by, b.vehicle_id, v.registration_number
      FROM vehicle_bookings b
      JOIN vehicles v ON v.id = b.vehicle_id
     WHERE b.id = ${bookingId} AND b.tenant_id = ${user.tenant_id}
  `;
  const booking = rows[0] as
    | { id: string; status: string; requested_by: string; vehicle_id: string; registration_number: string }
    | undefined;
  if (!booking) return { error: "Requisition not found." };
  if (booking.status !== "pending") return { error: "That requisition is already decided." };

  await db`
    UPDATE vehicle_bookings
       SET status = ${decision}, approved_by = ${user.id}, approved_at = now(),
           rejection_reason = ${decision === "rejected" ? reason : null}
     WHERE id = ${bookingId} AND tenant_id = ${user.tenant_id}
  `;
  await notify({
    tenantId: user.tenant_id,
    userId: booking.requested_by,
    title: decision === "approved" ? "Vehicle approved" : "Vehicle request declined",
    body:
      decision === "approved"
        ? `${booking.registration_number} is approved for your trip.`
        : `Your request for ${booking.registration_number} was declined${reason ? `: ${reason}` : "."}`,
    severity: "high",
    link: "/fleet/bookings",
  });
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: `booking.${decision}`,
    entity: "vehicle_booking",
    entityId: bookingId,
    summary: `${decision === "approved" ? "Approved" : "Declined"} ${booking.registration_number} requisition`,
  });

  revalidatePath("/fleet/bookings");
  return { success: decision === "approved" ? "Approved." : "Declined." };
}

/** Driver starts the trip: records the opening odometer and locks the vehicle. */
export async function startTripAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const bookingId = String(formData.get("bookingId") ?? "");
  const startOdometer = Number(formData.get("startOdometer") ?? 0);
  const db = await getDb();

  const rows = await db`
    SELECT b.id, b.status, b.driver_id, b.requested_by, b.vehicle_id,
           v.current_odometer, v.registration_number
      FROM vehicle_bookings b
      JOIN vehicles v ON v.id = b.vehicle_id
     WHERE b.id = ${bookingId} AND b.tenant_id = ${user.tenant_id}
  `;
  const b = rows[0] as
    | {
        id: string;
        status: string;
        driver_id: string | null;
        requested_by: string;
        vehicle_id: string;
        current_odometer: number;
        registration_number: string;
      }
    | undefined;
  if (!b) return { error: "Requisition not found." };
  if (b.status !== "approved") return { error: "This trip is not approved yet." };

  const isParticipant = b.driver_id === user.id || b.requested_by === user.id;
  if (!isParticipant && !hasPermission(user, "fleet", "edit")) {
    return { error: "Only the assigned driver or requester can start this trip." };
  }

  const opening = startOdometer > 0 ? startOdometer : b.current_odometer;

  await db`
    INSERT INTO trip_logs (tenant_id, booking_id, vehicle_id, driver_id, start_odometer, started_at)
    VALUES (${user.tenant_id}, ${bookingId}, ${b.vehicle_id}, ${b.driver_id ?? user.id},
            ${opening}, now())
    ON CONFLICT (booking_id) DO UPDATE
      SET start_odometer = EXCLUDED.start_odometer, started_at = EXCLUDED.started_at
  `;
  await db`UPDATE vehicle_bookings SET status = 'in_progress'
            WHERE id = ${bookingId} AND tenant_id = ${user.tenant_id}`;
  await db`UPDATE vehicles SET status = 'in_use'
            WHERE id = ${b.vehicle_id} AND tenant_id = ${user.tenant_id}`;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "trip.started",
    entity: "vehicle_booking",
    entityId: bookingId,
    summary: `Started trip with ${b.registration_number} at ${opening} km`,
  });
  revalidatePath("/fleet/bookings");
  return { success: "Trip started." };
}

const completeSchema = z.object({
  bookingId: z.string().uuid(),
  endOdometer: z.coerce.number().int().min(0).max(10_000_000),
  fuelLitres: z.coerce.number().min(0).max(10_000).default(0),
  fuelCost: z.coerce.number().min(0).max(10_000_000).default(0),
  tollCost: z.coerce.number().min(0).max(10_000_000).default(0),
  notes: nullable(400),
});

/**
 * Closes the trip: writes the distance, updates the vehicle's odometer,
 * frees the vehicle, and posts fuel and toll spend to the ledger so fleet
 * running cost lands in the accounts without a separate data entry step.
 */
export async function completeTripAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = completeSchema.safeParse({
    bookingId: formData.get("bookingId"),
    endOdometer: formData.get("endOdometer"),
    fuelLitres: formData.get("fuelLitres") || 0,
    fuelCost: formData.get("fuelCost") || 0,
    tollCost: formData.get("tollCost") || 0,
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const rows = await db`
    SELECT b.id, b.status, b.driver_id, b.requested_by, b.vehicle_id,
           t.start_odometer, v.registration_number
      FROM vehicle_bookings b
      JOIN vehicles v ON v.id = b.vehicle_id
      LEFT JOIN trip_logs t ON t.booking_id = b.id
     WHERE b.id = ${d.bookingId} AND b.tenant_id = ${user.tenant_id}
  `;
  const b = rows[0] as
    | {
        id: string;
        status: string;
        driver_id: string | null;
        requested_by: string;
        vehicle_id: string;
        start_odometer: number | null;
        registration_number: string;
      }
    | undefined;
  if (!b) return { error: "Requisition not found." };
  if (b.status !== "in_progress") return { error: "This trip is not in progress." };

  const isParticipant = b.driver_id === user.id || b.requested_by === user.id;
  if (!isParticipant && !hasPermission(user, "fleet", "edit")) {
    return { error: "Only the assigned driver or requester can close this trip." };
  }

  const opening = b.start_odometer ?? 0;
  if (d.endOdometer < opening) {
    return {
      fieldErrors: {
        endOdometer: [`The closing reading cannot be below the opening reading (${opening} km).`],
      },
    };
  }
  const distance = d.endOdometer - opening;

  await db`
    UPDATE trip_logs
       SET end_odometer = ${d.endOdometer}, distance_km = ${distance},
           fuel_litres = ${d.fuelLitres}, fuel_cost = ${d.fuelCost},
           toll_cost = ${d.tollCost}, ended_at = now(), notes = ${d.notes}
     WHERE booking_id = ${d.bookingId} AND tenant_id = ${user.tenant_id}
  `;
  await db`UPDATE vehicle_bookings SET status = 'completed'
            WHERE id = ${d.bookingId} AND tenant_id = ${user.tenant_id}`;
  await db`UPDATE vehicles SET status = 'available', current_odometer = ${d.endOdometer}
            WHERE id = ${b.vehicle_id} AND tenant_id = ${user.tenant_id}`;

  const spend = d.fuelCost + d.tollCost;
  if (spend > 0) {
    await postJournal(user.tenant_id, {
      date: isoDate(),
      description: `Trip costs — ${b.registration_number}`,
      source: "trip",
      sourceId: d.bookingId,
      createdBy: user.id,
      lines: [
        { accountKey: "fuel_expense", debit: spend, memo: `${distance} km` },
        { accountKey: "cash", credit: spend },
      ],
    });
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "trip.completed",
    entity: "vehicle_booking",
    entityId: d.bookingId,
    summary: `Completed ${distance} km trip with ${b.registration_number}`,
    meta: { distance, fuelCost: d.fuelCost },
  });

  revalidatePath("/fleet/bookings");
  revalidatePath("/fleet");
  return { success: `Trip closed — ${distance} km recorded.` };
}

/* --- maintenance ---------------------------------------------------------- */

const maintenanceSchema = z.object({
  vehicleId: z.string().uuid("Choose a vehicle"),
  serviceType: z.string().trim().min(2, "Describe the service").max(120),
  description: nullable(600),
  scheduledDate: nullableDate,
  cost: z.coerce.number().min(0).max(100_000_000).default(0),
  vendorId: nullableUuid,
  nextDueDate: nullableDate,
});

export async function createMaintenanceAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("fleet", "create");
  const parsed = maintenanceSchema.safeParse({
    vehicleId: formData.get("vehicleId"),
    serviceType: formData.get("serviceType") ?? "",
    description: formData.get("description") ?? "",
    scheduledDate: formData.get("scheduledDate") ?? "",
    cost: formData.get("cost") || 0,
    vendorId: formData.get("vendorId") ?? "",
    nextDueDate: formData.get("nextDueDate") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const owned = await db`
    SELECT 1 FROM vehicles WHERE id = ${d.vehicleId} AND tenant_id = ${user.tenant_id}
  `;
  if (owned.length === 0) return { error: "Vehicle not found." };

  await db`
    INSERT INTO vehicle_maintenance (tenant_id, vehicle_id, service_type, description,
                                     scheduled_date, cost, vendor_id, next_due_date, status)
    VALUES (${user.tenant_id}, ${d.vehicleId}, ${d.serviceType}, ${d.description},
            ${d.scheduledDate}, ${d.cost}, ${d.vendorId}, ${d.nextDueDate}, 'scheduled')
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "maintenance.scheduled",
    entity: "vehicle_maintenance",
    summary: `Scheduled ${d.serviceType}`,
  });
  revalidatePath("/fleet/maintenance");
  return { success: "Maintenance scheduled." };
}

/** Completing a service posts its cost and returns the vehicle to service. */
export async function completeMaintenanceAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("fleet", "edit");
  const id = String(formData.get("maintenanceId") ?? "");
  const cost = Number(formData.get("cost") ?? 0);
  const db = await getDb();

  const rows = await db`
    SELECT m.id, m.status, m.service_type, m.vehicle_id, m.cost::float AS cost,
           v.registration_number
      FROM vehicle_maintenance m
      JOIN vehicles v ON v.id = m.vehicle_id
     WHERE m.id = ${id} AND m.tenant_id = ${user.tenant_id}
  `;
  const m = rows[0] as
    | {
        id: string;
        status: string;
        service_type: string;
        vehicle_id: string;
        cost: number;
        registration_number: string;
      }
    | undefined;
  if (!m) return { error: "Maintenance record not found." };
  if (m.status === "completed") return { error: "Already completed." };

  const finalCost = cost > 0 ? cost : m.cost;

  await db`
    UPDATE vehicle_maintenance
       SET status = 'completed', completed_date = CURRENT_DATE, cost = ${finalCost}
     WHERE id = ${id} AND tenant_id = ${user.tenant_id}
  `;
  await db`
    UPDATE vehicles SET status = 'available'
     WHERE id = ${m.vehicle_id} AND tenant_id = ${user.tenant_id} AND status = 'maintenance'
  `;

  if (finalCost > 0) {
    await postJournal(user.tenant_id, {
      date: isoDate(),
      description: `${m.service_type} — ${m.registration_number}`,
      source: "maintenance",
      sourceId: id,
      createdBy: user.id,
      lines: [
        { accountKey: "maintenance_expense", debit: finalCost },
        { accountKey: "cash", credit: finalCost },
      ],
    });
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "maintenance.completed",
    entity: "vehicle_maintenance",
    entityId: id,
    summary: `Completed ${m.service_type} on ${m.registration_number}`,
  });
  revalidatePath("/fleet/maintenance");
  revalidatePath("/fleet");
  return { success: "Maintenance closed." };
}
