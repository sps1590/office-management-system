"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { isoDate, zonedToSql } from "@/lib/utils";
import { nextDocNumber } from "@/lib/sequence";
import { findFreeSlots, slotLabel } from "@/lib/workplace";
import { audit, notify } from "@/lib/audit";
import { countOf, stillInUse } from "@/lib/guards";
import type { ActionState } from "@/lib/types";

const nullable = (max = 300) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

const nullableUuid = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || /^[0-9a-f-]{36}$/i.test(v), "Invalid selection");

const nullableDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

/* --- rooms ---------------------------------------------------------------- */

export async function createRoomAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("facilities", "create");
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Name is required").max(120),
      code: nullable(20),
      floor: nullable(40),
      capacity: z.coerce.number().int().min(0).max(10_000).default(0),
      amenities: nullable(300),
    })
    .safeParse({
      name: formData.get("name") ?? "",
      code: formData.get("code") ?? "",
      floor: formData.get("floor") ?? "",
      capacity: formData.get("capacity") || 0,
      amenities: formData.get("amenities") ?? "",
    });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const clash = await db`
    SELECT 1 FROM rooms WHERE tenant_id = ${user.tenant_id} AND name = ${d.name}
  `;
  if (clash.length > 0) {
    return { fieldErrors: { name: ["A room with that name already exists."] } };
  }

  const amenities = (d.amenities ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await db`
    INSERT INTO rooms (tenant_id, name, code, floor, capacity, amenities, status)
    VALUES (${user.tenant_id}, ${d.name}, ${d.code}, ${d.floor}, ${d.capacity},
            ${JSON.stringify(amenities)}::jsonb, 'available')
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "room.created",
    entity: "room",
    summary: `Added room ${d.name}`,
  });
  revalidatePath("/rooms");
  return { success: `Room "${d.name}" added.` };
}

const roomBookingSchema = z
  .object({
    roomId: z.string().uuid("Choose a room"),
    title: z.string().trim().min(2, "Give the meeting a title").max(160),
    purpose: nullable(300),
    startTime: z.string().min(10, "Pick a start time"),
    endTime: z.string().min(10, "Pick an end time"),
    attendeeCount: z.coerce.number().int().min(1).max(1000).default(1),
  })
  .refine((v) => new Date(v.endTime) > new Date(v.startTime), {
    message: "The end time must be after the start time",
    path: ["endTime"],
  });

/** Books a room, refusing an overlap so the same room cannot be double-booked. */
export async function bookRoomAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  if (!hasPermission(user, "facilities", "create")) {
    return { error: "You do not have permission to book a room." };
  }
  const parsed = roomBookingSchema.safeParse({
    roomId: formData.get("roomId"),
    title: formData.get("title") ?? "",
    purpose: formData.get("purpose") ?? "",
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    attendeeCount: formData.get("attendeeCount") || 1,
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  // The typed clock is the company's, not the server's or the database's.
  const startAt = zonedToSql(d.startTime, user.tenant.timezone);
  const endAt = zonedToSql(d.endTime, user.tenant.timezone);
  // Both are required, so an unparseable clock is a refusal rather than a
  // null reaching a NOT NULL column.
  if (!startAt || !endAt) {
    return { fieldErrors: { startTime: ["Pick a valid date and time."] } };
  }

  const rooms = await db`
    SELECT name, capacity, status FROM rooms
     WHERE id = ${d.roomId} AND tenant_id = ${user.tenant_id}
  `;
  const room = rooms[0] as { name: string; capacity: number; status: string } | undefined;
  if (!room) return { error: "Room not found." };
  if (room.status !== "available") {
    return { error: `${room.name} is currently ${room.status}.` };
  }
  if (room.capacity > 0 && d.attendeeCount > room.capacity) {
    return {
      fieldErrors: {
        attendeeCount: [`${room.name} seats ${room.capacity}.`],
      },
    };
  }

  const overlap = await db`
    SELECT start_time, end_time FROM room_bookings
     WHERE tenant_id = ${user.tenant_id} AND room_id = ${d.roomId}
       AND status = 'confirmed'
       AND start_time < ${endAt} AND end_time > ${startAt}
     ORDER BY start_time
     LIMIT 1
  `;
  if (overlap.length > 0) {
    // "Already booked" on its own leaves someone guessing at times until one
    // sticks, so the refusal carries the clash it hit and the room's next
    // free windows, each one click away from being the new request.
    const taken = overlap[0] as { start_time: string; end_time: string };
    const busyAt = slotLabel(
      taken.start_time,
      taken.end_time,
      startAt,
      user.tenant.timezone
    );
    const free = await findFreeSlots(
      user.tenant_id,
      d.roomId,
      d.startTime,
      d.endTime,
      user.tenant.timezone
    );
    return {
      error:
        free.length > 0
          ? `${room.name} is already booked ${busyAt}. It is free at these times:`
          : `${room.name} is already booked ${busyAt}, and has no free slot that long in the next week.`,
      suggestions: free.map((s) => ({
        label: s.label,
        values: { startTime: s.start, endTime: s.end },
      })),
    };
  }

  await db`
    INSERT INTO room_bookings (tenant_id, room_id, booked_by, title, purpose,
                               start_time, end_time, attendee_count, status)
    VALUES (${user.tenant_id}, ${d.roomId}, ${user.id}, ${d.title}, ${d.purpose},
            ${startAt}, ${endAt}, ${d.attendeeCount}, 'confirmed')
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "room.booked",
    entity: "room_booking",
    summary: `Booked ${room.name}: ${d.title}`,
  });
  revalidatePath("/rooms");
  return { success: `${room.name} booked.` };
}

export async function cancelRoomBookingAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const bookingId = String(formData.get("bookingId") ?? "");
  const db = await getDb();

  const rows = await db`
    SELECT booked_by, title FROM room_bookings
     WHERE id = ${bookingId} AND tenant_id = ${user.tenant_id}
  `;
  const booking = rows[0] as { booked_by: string; title: string } | undefined;
  if (!booking) return { error: "Booking not found." };
  if (booking.booked_by !== user.id && !hasPermission(user, "facilities", "edit")) {
    return { error: "You can only cancel your own booking." };
  }

  await db`
    UPDATE room_bookings SET status = 'cancelled'
     WHERE id = ${bookingId} AND tenant_id = ${user.tenant_id}
  `;
  revalidatePath("/rooms");
  return { success: "Booking cancelled." };
}

/* --- visitors ------------------------------------------------------------- */

export async function logVisitorAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("facilities", "create");
  const parsed = z
    .object({
      fullName: z.string().trim().min(2, "Visitor name is required").max(120),
      company: nullable(120),
      phone: nullable(32),
      hostUserId: nullableUuid,
      purpose: nullable(200),
      vehicleNumber: nullable(32),
    })
    .safeParse({
      fullName: formData.get("fullName") ?? "",
      company: formData.get("company") ?? "",
      phone: formData.get("phone") ?? "",
      hostUserId: formData.get("hostUserId") ?? "",
      purpose: formData.get("purpose") ?? "",
      vehicleNumber: formData.get("vehicleNumber") ?? "",
    });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();
  const badge = await nextDocNumber(user.tenant_id, "visitor", "VIS");

  await db`
    INSERT INTO visitors (tenant_id, full_name, company, phone, host_user_id, purpose,
                          badge_number, vehicle_number)
    VALUES (${user.tenant_id}, ${d.fullName}, ${d.company}, ${d.phone}, ${d.hostUserId},
            ${d.purpose}, ${badge}, ${d.vehicleNumber})
  `;
  if (d.hostUserId) {
    await notify({
      tenantId: user.tenant_id,
      userId: d.hostUserId,
      title: "Your visitor has arrived",
      body: `${d.fullName}${d.company ? ` from ${d.company}` : ""} is at reception. Badge ${badge}.`,
      severity: "high",
      link: "/visitors",
    });
  }
  revalidatePath("/visitors");
  return { success: `${d.fullName} checked in with badge ${badge}.` };
}

export async function checkOutVisitorAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("facilities", "edit");
  const visitorId = String(formData.get("visitorId") ?? "");
  const db = await getDb();

  const updated = await db`
    UPDATE visitors SET checked_out_at = now()
     WHERE id = ${visitorId} AND tenant_id = ${user.tenant_id} AND checked_out_at IS NULL
    RETURNING full_name
  `;
  if (updated.length === 0) return { error: "Visitor not found, or already checked out." };

  revalidatePath("/visitors");
  return { success: `${(updated[0] as { full_name: string }).full_name} checked out.` };
}

/* --- assets --------------------------------------------------------------- */

const assetSchema = z.object({
  name: z.string().trim().min(2, "Asset name is required").max(160),
  assetTag: nullable(40),
  category: nullable(80),
  serialNumber: nullable(80),
  assignedTo: nullableUuid,
  departmentId: nullableUuid,
  purchaseDate: nullableDate,
  purchaseCost: z.coerce.number().min(0).max(1_000_000_000).default(0),
  warrantyExpiry: nullableDate,
  condition: z.enum(["new", "good", "fair", "poor", "damaged"]),
  location: nullable(120),
});

export async function createAssetAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("assets", "create");
  const parsed = assetSchema.safeParse({
    name: formData.get("name") ?? "",
    assetTag: formData.get("assetTag") ?? "",
    category: formData.get("category") ?? "",
    serialNumber: formData.get("serialNumber") ?? "",
    assignedTo: formData.get("assignedTo") ?? "",
    departmentId: formData.get("departmentId") ?? "",
    purchaseDate: formData.get("purchaseDate") ?? "",
    purchaseCost: formData.get("purchaseCost") || 0,
    warrantyExpiry: formData.get("warrantyExpiry") ?? "",
    condition: formData.get("condition") || "good",
    location: formData.get("location") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();
  const tag = d.assetTag ?? (await nextDocNumber(user.tenant_id, "asset", "AST"));

  const clash = await db`
    SELECT 1 FROM assets WHERE tenant_id = ${user.tenant_id} AND asset_tag = ${tag}
  `;
  if (clash.length > 0) {
    return { fieldErrors: { assetTag: ["That asset tag is already in use."] } };
  }

  const inserted = await db`
    INSERT INTO assets (tenant_id, asset_tag, name, category, serial_number, assigned_to,
                        department_id, purchase_date, purchase_cost, current_value,
                        warranty_expiry, condition, status, location)
    VALUES (${user.tenant_id}, ${tag}, ${d.name}, ${d.category}, ${d.serialNumber},
            ${d.assignedTo}, ${d.departmentId}, ${d.purchaseDate}, ${d.purchaseCost},
            ${d.purchaseCost}, ${d.warrantyExpiry}, ${d.condition},
            ${d.assignedTo ? "in_use" : "in_store"}, ${d.location})
    RETURNING id
  `;
  const assetId = (inserted[0] as { id: string }).id;

  if (d.assignedTo) {
    await db`
      INSERT INTO asset_assignments (tenant_id, asset_id, user_id, note, assigned_on)
      VALUES (${user.tenant_id}, ${assetId}, ${d.assignedTo}, 'Initial assignment',
              ${isoDate(user.tenant.timezone)}::date)
    `;
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "asset.created",
    entity: "asset",
    entityId: assetId,
    summary: `Registered asset ${d.name} (${tag})`,
  });
  revalidatePath("/assets");
  return { success: `${d.name} registered as ${tag}.` };
}

/** Hands an asset to someone, or takes it back into store. */
export async function assignAssetAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("assets", "edit");
  const parsed = z
    .object({
      assetId: z.string().uuid(),
      userId: nullableUuid,
      status: z.enum(["in_use", "in_store", "under_repair", "disposed", "lost"]),
    })
    .safeParse({
      assetId: formData.get("assetId"),
      userId: formData.get("userId") ?? "",
      status: formData.get("status") || "in_use",
    });
  if (!parsed.success) return { error: "Invalid request." };
  const d = parsed.data;
  const db = await getDb();

  const rows = await db`
    SELECT name, assigned_to FROM assets
     WHERE id = ${d.assetId} AND tenant_id = ${user.tenant_id}
  `;
  const asset = rows[0] as { name: string; assigned_to: string | null } | undefined;
  if (!asset) return { error: "Asset not found." };

  // Close the previous holder's assignment before opening a new one, so the
  // history reads as a chain of custody rather than overlapping claims.
  if (asset.assigned_to && asset.assigned_to !== d.userId) {
    await db`
      UPDATE asset_assignments SET returned_on = ${isoDate(user.tenant.timezone)}::date
       WHERE tenant_id = ${user.tenant_id} AND asset_id = ${d.assetId}
         AND user_id = ${asset.assigned_to} AND returned_on IS NULL
    `;
  }

  await db`
    UPDATE assets SET assigned_to = ${d.userId}, status = ${d.status}
     WHERE id = ${d.assetId} AND tenant_id = ${user.tenant_id}
  `;

  if (d.userId && d.userId !== asset.assigned_to) {
    await db`
      INSERT INTO asset_assignments (tenant_id, asset_id, user_id, assigned_on)
      VALUES (${user.tenant_id}, ${d.assetId}, ${d.userId},
              ${isoDate(user.tenant.timezone)}::date)
    `;
    await notify({
      tenantId: user.tenant_id,
      userId: d.userId,
      title: "Asset assigned to you",
      body: `${asset.name} is now in your care.`,
      link: "/assets",
    });
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "asset.assigned",
    entity: "asset",
    entityId: d.assetId,
    summary: `${asset.name} set to ${d.status.replace(/_/g, " ")}`,
  });
  revalidatePath("/assets");
  return { success: "Asset updated." };
}

/* --- projects and tasks --------------------------------------------------- */

export async function createProjectAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("tasks", "create");
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Project name is required").max(160),
      code: nullable(20),
      description: nullable(600),
      ownerId: nullableUuid,
      startDate: nullableDate,
      endDate: nullableDate,
    })
    .safeParse({
      name: formData.get("name") ?? "",
      code: formData.get("code") ?? "",
      description: formData.get("description") ?? "",
      ownerId: formData.get("ownerId") ?? "",
      startDate: formData.get("startDate") ?? "",
      endDate: formData.get("endDate") ?? "",
    });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  await db`
    INSERT INTO projects (tenant_id, name, code, description, owner_id, status,
                          start_date, end_date)
    VALUES (${user.tenant_id}, ${d.name}, ${d.code}, ${d.description},
            ${d.ownerId ?? user.id}, 'active', ${d.startDate}, ${d.endDate})
  `;
  revalidatePath("/tasks");
  return { success: `Project "${d.name}" created.` };
}

const taskSchema = z.object({
  title: z.string().trim().min(2, "Give the task a title").max(200),
  description: nullable(1000),
  assignedTo: nullableUuid,
  projectId: nullableUuid,
  priority: z.enum(["low", "medium", "high", "urgent"]),
  dueDate: nullableDate,
});

export async function createTaskAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("tasks", "create");
  const parsed = taskSchema.safeParse({
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? "",
    assignedTo: formData.get("assignedTo") ?? "",
    projectId: formData.get("projectId") ?? "",
    priority: formData.get("priority") || "medium",
    dueDate: formData.get("dueDate") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const inserted = await db`
    INSERT INTO tasks (tenant_id, project_id, title, description, assigned_to, created_by,
                       priority, status, due_date)
    VALUES (${user.tenant_id}, ${d.projectId}, ${d.title}, ${d.description},
            ${d.assignedTo}, ${user.id}, ${d.priority}, 'todo', ${d.dueDate})
    RETURNING id
  `;
  const taskId = (inserted[0] as { id: string }).id;

  if (d.assignedTo && d.assignedTo !== user.id) {
    await notify({
      tenantId: user.tenant_id,
      userId: d.assignedTo,
      title: "Task assigned to you",
      body: d.title,
      severity: d.priority === "urgent" ? "critical" : "normal",
      link: "/tasks",
      entity: "task",
      entityId: taskId,
    });
  }
  revalidatePath("/tasks");
  return { success: "Task created." };
}

/**
 * Status change. Marking a task done stamps the coordinate when the browser
 * supplied one — the proof-of-presence requirement in SRS 3.2 for field work.
 */
export async function setTaskStatusAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = z
    .object({
      taskId: z.string().uuid(),
      status: z.enum(["todo", "in_progress", "review", "done", "cancelled"]),
    })
    .safeParse({
      taskId: formData.get("taskId"),
      status: formData.get("status"),
    });
  if (!parsed.success) return { error: "Invalid request." };
  const { taskId, status } = parsed.data;
  const lat = Number(formData.get("latitude") ?? NaN);
  const lng = Number(formData.get("longitude") ?? NaN);
  const db = await getDb();

  const rows = await db`
    SELECT id, title, assigned_to, created_by FROM tasks
     WHERE id = ${taskId} AND tenant_id = ${user.tenant_id}
  `;
  const task = rows[0] as
    | { id: string; title: string; assigned_to: string | null; created_by: string | null }
    | undefined;
  if (!task) return { error: "Task not found." };

  const isInvolved = task.assigned_to === user.id || task.created_by === user.id;
  if (!isInvolved && !hasPermission(user, "tasks", "edit")) {
    return { error: "This task belongs to someone else." };
  }

  const done = status === "done";
  await db`
    UPDATE tasks
       SET status = ${status},
           started_at = CASE WHEN ${status} = 'in_progress' AND started_at IS NULL
                             THEN now() ELSE started_at END,
           completed_at = ${done ? new Date().toISOString() : null},
           completed_lat = ${done && Number.isFinite(lat) ? lat : null},
           completed_lng = ${done && Number.isFinite(lng) ? lng : null},
           updated_at = now()
     WHERE id = ${taskId} AND tenant_id = ${user.tenant_id}
  `;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: `task.${status}`,
    entity: "task",
    entityId: taskId,
    summary: `"${task.title}" set to ${status.replace(/_/g, " ")}`,
    meta: done && Number.isFinite(lat) ? { lat, lng } : {},
  });
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return {
    success: done && Number.isFinite(lat) ? "Completed, with location recorded." : "Updated.",
  };
}

export async function commentOnTaskAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const taskId = String(formData.get("taskId") ?? "");
  const body = String(formData.get("body") ?? "").trim().slice(0, 2000);
  if (!body) return { error: "Write something first." };
  const db = await getDb();

  const owned = await db`
    SELECT 1 FROM tasks WHERE id = ${taskId} AND tenant_id = ${user.tenant_id}
  `;
  if (owned.length === 0) return { error: "Task not found." };

  await db`
    INSERT INTO task_comments (tenant_id, task_id, user_id, body)
    VALUES (${user.tenant_id}, ${taskId}, ${user.id}, ${body})
  `;
  revalidatePath("/tasks");
  return { success: "Comment added." };
}

/* --- editing and removing the facilities master data ---------------------- */

export async function updateRoomAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("facilities", "edit");
  const parsed = z
    .object({
      roomId: z.string().uuid(),
      name: z.string().trim().min(2, "Name is required").max(120),
      code: nullable(20),
      floor: nullable(40),
      capacity: z.coerce.number().int().min(0).max(10_000).default(0),
      amenities: nullable(300),
      status: z.enum(["available", "maintenance", "retired"]),
    })
    .safeParse({
      roomId: formData.get("roomId"),
      name: formData.get("name") ?? "",
      code: formData.get("code") ?? "",
      floor: formData.get("floor") ?? "",
      capacity: formData.get("capacity") || 0,
      amenities: formData.get("amenities") ?? "",
      status: formData.get("status") || "available",
    });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const clash = await db`
    SELECT 1 FROM rooms
     WHERE tenant_id = ${user.tenant_id} AND name = ${d.name} AND id <> ${d.roomId}
  `;
  if (clash.length > 0) {
    return { fieldErrors: { name: ["Another room already has that name."] } };
  }

  const amenities = (d.amenities ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  const updated = await db`
    UPDATE rooms
       SET name = ${d.name}, code = ${d.code}, floor = ${d.floor},
           capacity = ${d.capacity}, status = ${d.status},
           amenities = ${JSON.stringify(amenities)}::jsonb
     WHERE id = ${d.roomId} AND tenant_id = ${user.tenant_id}
    RETURNING name
  `;
  if (updated.length === 0) return { error: "Room not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "room.updated",
    entity: "room",
    entityId: d.roomId,
    summary: `Updated room ${d.name}`,
  });
  revalidatePath("/rooms");
  return { success: "Room updated." };
}

export async function deleteRoomAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("facilities", "edit");
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid request." };
  const db = await getDb();

  const bookings = await db`
    SELECT COUNT(*)::int AS n FROM room_bookings
     WHERE tenant_id = ${user.tenant_id} AND room_id = ${id}
  `;
  const blocked = stillInUse(
    [{ n: countOf(bookings), label: "booking" }],
    "Set it to retired instead: the bookings stay and nobody can book it again."
  );
  if (blocked) return { error: blocked };

  const gone = await db`
    DELETE FROM rooms WHERE id = ${id} AND tenant_id = ${user.tenant_id} RETURNING name
  `;
  if (gone.length === 0) return { error: "Room not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "room.deleted",
    entity: "room",
    entityId: id,
    summary: `Deleted the never-booked room ${(gone[0] as { name: string }).name}`,
  });
  revalidatePath("/rooms");
  return { success: "Room deleted." };
}

export async function updateAssetAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("assets", "edit");
  const parsed = assetSchema.extend({ assetId: z.string().uuid() }).safeParse({
    assetId: formData.get("assetId"),
    name: formData.get("name") ?? "",
    assetTag: formData.get("assetTag") ?? "",
    category: formData.get("category") ?? "",
    serialNumber: formData.get("serialNumber") ?? "",
    assignedTo: formData.get("assignedTo") ?? "",
    departmentId: formData.get("departmentId") ?? "",
    purchaseDate: formData.get("purchaseDate") ?? "",
    purchaseCost: formData.get("purchaseCost") || 0,
    warrantyExpiry: formData.get("warrantyExpiry") ?? "",
    condition: formData.get("condition") || "good",
    location: formData.get("location") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const updated = await db`
    UPDATE assets
       SET name = ${d.name}, asset_tag = COALESCE(${d.assetTag}, asset_tag),
           category = ${d.category}, serial_number = ${d.serialNumber},
           assigned_to = ${d.assignedTo}, department_id = ${d.departmentId},
           purchase_date = ${d.purchaseDate}, purchase_cost = ${d.purchaseCost},
           warranty_expiry = ${d.warrantyExpiry}, condition = ${d.condition},
           location = ${d.location}
     WHERE id = ${d.assetId} AND tenant_id = ${user.tenant_id}
    RETURNING name
  `;
  if (updated.length === 0) return { error: "Asset not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "asset.updated",
    entity: "asset",
    entityId: d.assetId,
    summary: `Updated asset ${d.name}`,
  });
  revalidatePath("/assets");
  return { success: "Asset updated." };
}

export async function deleteAssetAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("assets", "edit");
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid request." };
  const db = await getDb();

  const assignments = await db`
    SELECT COUNT(*)::int AS n FROM asset_assignments
     WHERE tenant_id = ${user.tenant_id} AND asset_id = ${id}
  `;
  const blocked = stillInUse(
    [{ n: countOf(assignments), label: "assignment record" }],
    "Set it to disposed instead: the custody trail stays, which is the point of keeping one."
  );
  if (blocked) return { error: blocked };

  const gone = await db`
    DELETE FROM assets WHERE id = ${id} AND tenant_id = ${user.tenant_id} RETURNING name
  `;
  if (gone.length === 0) return { error: "Asset not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "asset.deleted",
    entity: "asset",
    entityId: id,
    summary: `Deleted asset ${(gone[0] as { name: string }).name}, which was never assigned`,
  });
  revalidatePath("/assets");
  return { success: "Asset deleted." };
}

export async function updateProjectAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("tasks", "edit");
  const parsed = z
    .object({
      projectId: z.string().uuid(),
      name: z.string().trim().min(2, "Project name is required").max(160),
      code: nullable(20),
      description: nullable(600),
      ownerId: nullableUuid,
      status: z.enum(["planning", "active", "on_hold", "completed", "cancelled"]),
      startDate: nullableDate,
      endDate: nullableDate,
    })
    .safeParse({
      projectId: formData.get("projectId"),
      name: formData.get("name") ?? "",
      code: formData.get("code") ?? "",
      description: formData.get("description") ?? "",
      ownerId: formData.get("ownerId") ?? "",
      status: formData.get("status") || "active",
      startDate: formData.get("startDate") ?? "",
      endDate: formData.get("endDate") ?? "",
    });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const updated = await db`
    UPDATE projects
       SET name = ${d.name}, code = ${d.code}, description = ${d.description},
           owner_id = ${d.ownerId}, status = ${d.status},
           start_date = ${d.startDate}, end_date = ${d.endDate}
     WHERE id = ${d.projectId} AND tenant_id = ${user.tenant_id}
    RETURNING name
  `;
  if (updated.length === 0) return { error: "Project not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "project.updated",
    entity: "project",
    entityId: d.projectId,
    summary: `Updated project ${d.name}`,
  });
  revalidatePath("/tasks");
  return { success: "Project updated." };
}

export async function deleteProjectAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("tasks", "edit");
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid request." };
  const db = await getDb();

  // Tasks detach rather than cascade, so deleting a live project would leave
  // its work orphaned in the backlog with no sign of where it came from.
  const tasks = await db`
    SELECT COUNT(*)::int AS n FROM tasks
     WHERE tenant_id = ${user.tenant_id} AND project_id = ${id}
  `;
  const blocked = stillInUse(
    [{ n: countOf(tasks), label: "task" }],
    "Set it to completed or cancelled instead, so its tasks keep their home."
  );
  if (blocked) return { error: blocked };

  const gone = await db`
    DELETE FROM projects WHERE id = ${id} AND tenant_id = ${user.tenant_id} RETURNING name
  `;
  if (gone.length === 0) return { error: "Project not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "project.deleted",
    entity: "project",
    entityId: id,
    summary: `Deleted the empty project ${(gone[0] as { name: string }).name}`,
  });
  revalidatePath("/tasks");
  return { success: "Project deleted." };
}

export async function updateTaskAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("tasks", "edit");
  const parsed = taskSchema.extend({ taskId: z.string().uuid() }).safeParse({
    taskId: formData.get("taskId"),
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? "",
    assignedTo: formData.get("assignedTo") ?? "",
    projectId: formData.get("projectId") ?? "",
    priority: formData.get("priority") || "medium",
    dueDate: formData.get("dueDate") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const updated = await db`
    UPDATE tasks
       SET title = ${d.title}, description = ${d.description},
           assigned_to = ${d.assignedTo}, project_id = ${d.projectId},
           priority = ${d.priority}, due_date = ${d.dueDate}, updated_at = now()
     WHERE id = ${d.taskId} AND tenant_id = ${user.tenant_id}
    RETURNING title
  `;
  if (updated.length === 0) return { error: "Task not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "task.updated",
    entity: "task",
    entityId: d.taskId,
    summary: `Updated task ${d.title}`,
  });
  revalidatePath("/tasks");
  return { success: "Task updated." };
}

/**
 * Deletes a task, and its comments with it.
 *
 * The only delete in the product that takes dependent rows down with it,
 * deliberately: a task is a plan rather than a record of something that
 * happened, a mistyped one is common, and its comments have no meaning once
 * the task is gone. Nothing that *is* a record — an attendance row, a field
 * visit — references a task.
 */
export async function deleteTaskAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("tasks", "edit");
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid request." };

  const db = await getDb();
  const gone = await db`
    DELETE FROM tasks WHERE id = ${id} AND tenant_id = ${user.tenant_id} RETURNING title
  `;
  if (gone.length === 0) return { error: "Task not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "task.deleted",
    entity: "task",
    entityId: id,
    summary: `Deleted task ${(gone[0] as { title: string }).title}`,
  });
  revalidatePath("/tasks");
  return { success: "Task deleted." };
}
