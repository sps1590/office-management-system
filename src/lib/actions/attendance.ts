"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { isoDate, zonedToInstant } from "@/lib/utils";
import { shiftForUser } from "@/lib/shifts";
import {
  computeLateMinutes,
  computeOvertimeMinutes,
  computeWorkedMinutes,
  matchOfficeGeofence,
  resolveStatus,
} from "@/lib/attendance";
import type { ActionState } from "@/lib/types";

const coordsSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  accuracy: z.coerce.number().min(0).optional(),
});

function readCoords(formData: FormData) {
  const parsed = coordsSchema.safeParse({
    latitude: formData.get("latitude") || undefined,
    longitude: formData.get("longitude") || undefined,
    accuracy: formData.get("accuracy") || undefined,
  });
  return parsed.success ? parsed.data : {};
}

/**
 * Geo-fenced check-in (SRS 3.4). The coordinate is matched against the
 * tenant's office/warehouse geofences server-side; when the tenant requires
 * a geofenced check-in and the coordinate is outside every fence, the
 * check-in is refused. The client cannot assert that it was inside.
 */
export async function checkInAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const db = await getDb();
  const settings = await getSettings(user.tenant_id);
  const { latitude, longitude, accuracy } = readCoords(formData);
  const today = isoDate(user.tenant.timezone);

  const existing = await db`
    SELECT id, check_in_at FROM attendance_records
     WHERE tenant_id = ${user.tenant_id} AND user_id = ${user.id} AND work_date = ${today}
  `;
  if ((existing[0] as { check_in_at: string | null } | undefined)?.check_in_at) {
    return { error: "You have already checked in today." };
  }

  let geofenceId: string | null = null;
  let insideGeofence: boolean | null = null;

  if (latitude != null && longitude != null) {
    const match = await matchOfficeGeofence(user.tenant_id, { latitude, longitude });
    geofenceId = match?.geofenceId ?? null;
    insideGeofence = !!match;
    if (settings.require_geofenced_checkin && !match) {
      return {
        error:
          "You are outside every registered office location. Check in from the office, or ask HR to record this day manually.",
      };
    }
  } else if (settings.require_geofenced_checkin) {
    return {
      error:
        "Location is required to check in. Allow location access in your browser and try again.",
    };
  }

  const now = new Date();
  const shift = await shiftForUser(user.tenant_id, user.id);
  const lateMinutes = computeLateMinutes(now, settings, user.tenant.timezone, shift);
  const status = lateMinutes > 0 ? "late" : "present";

  await db`
    INSERT INTO attendance_records
      (tenant_id, user_id, work_date, check_in_at, check_in_lat, check_in_lng,
       check_in_accuracy, geofence_id, inside_geofence, late_minutes, status, source)
    VALUES (${user.tenant_id}, ${user.id}, ${today}, ${now.toISOString()},
            ${latitude ?? null}, ${longitude ?? null}, ${accuracy ?? null},
            ${geofenceId}, ${insideGeofence}, ${lateMinutes}, ${status}, 'web')
    ON CONFLICT (tenant_id, user_id, work_date) DO UPDATE
      SET check_in_at = EXCLUDED.check_in_at,
          check_in_lat = EXCLUDED.check_in_lat,
          check_in_lng = EXCLUDED.check_in_lng,
          check_in_accuracy = EXCLUDED.check_in_accuracy,
          geofence_id = EXCLUDED.geofence_id,
          inside_geofence = EXCLUDED.inside_geofence,
          late_minutes = EXCLUDED.late_minutes,
          status = EXCLUDED.status
  `;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "attendance.check_in",
    entity: "attendance",
    summary: `Checked in${lateMinutes > 0 ? ` (${lateMinutes} min late)` : ""}`,
    meta: { latitude, longitude, insideGeofence },
  });

  revalidatePath("/dashboard");
  revalidatePath("/attendance");
  return {
    success:
      lateMinutes > 0
        ? `Checked in — ${lateMinutes} minutes after the grace period.`
        : "Checked in. Have a good day.",
  };
}

export async function checkOutAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const db = await getDb();
  const settings = await getSettings(user.tenant_id);
  const { latitude, longitude } = readCoords(formData);
  const today = isoDate(user.tenant.timezone);

  const rows = await db`
    SELECT id, check_in_at, check_out_at, late_minutes
      FROM attendance_records
     WHERE tenant_id = ${user.tenant_id} AND user_id = ${user.id} AND work_date = ${today}
  `;
  const record = rows[0] as
    | { id: string; check_in_at: string | null; check_out_at: string | null; late_minutes: number }
    | undefined;

  if (!record?.check_in_at) return { error: "You have not checked in today." };
  if (record.check_out_at) return { error: "You have already checked out today." };

  const now = new Date();
  const shift = await shiftForUser(user.tenant_id, user.id);
  const worked = computeWorkedMinutes(new Date(record.check_in_at), now);
  const overtime = computeOvertimeMinutes(worked, settings, shift);
  const status = resolveStatus(worked, record.late_minutes, settings, shift);

  await db`
    UPDATE attendance_records
       SET check_out_at = ${now.toISOString()},
           check_out_lat = ${latitude ?? null},
           check_out_lng = ${longitude ?? null},
           worked_minutes = ${worked},
           overtime_minutes = ${overtime},
           status = ${status}
     WHERE id = ${record.id} AND tenant_id = ${user.tenant_id}
  `;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "attendance.check_out",
    entity: "attendance",
    entityId: record.id,
    summary: `Checked out after ${Math.floor(worked / 60)}h ${worked % 60}m`,
    meta: { worked, overtime },
  });

  revalidatePath("/dashboard");
  revalidatePath("/attendance");
  const h = Math.floor(worked / 60);
  return {
    success: `Checked out — ${h}h ${worked % 60}m recorded${
      overtime > 0 ? `, including ${Math.floor(overtime / 60)}h ${overtime % 60}m overtime` : ""
    }.`,
  };
}

const manualSchema = z.object({
  userId: z.string().uuid("Select an employee"),
  workDate: z.string().min(10, "Pick a date"),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  status: z.enum([
    "present",
    "late",
    "absent",
    "half_day",
    "on_leave",
    "holiday",
    "weekend",
  ]),
  note: z.string().trim().max(400).optional(),
});

/** HR override for a missed or disputed day. Needs attendance.edit. */
export async function manualAttendanceAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("attendance", "edit");
  const parsed = manualSchema.safeParse({
    userId: formData.get("userId"),
    workDate: formData.get("workDate"),
    checkIn: formData.get("checkIn") || undefined,
    checkOut: formData.get("checkOut") || undefined,
    status: formData.get("status"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();
  const settings = await getSettings(user.tenant_id);

  // The target must belong to the caller's tenant: without this check an
  // attacker could post another company's user id.
  const target = await db`
    SELECT id FROM users WHERE id = ${d.userId} AND tenant_id = ${user.tenant_id}
  `;
  if (target.length === 0) return { error: "Employee not found." };

  // A date and a time typed by HR are the office's wall clock, so they are
  // resolved through the tenant's zone rather than parsed as the server's.
  const zone = user.tenant.timezone;
  const inAt = d.checkIn ? zonedToInstant(`${d.workDate}T${d.checkIn}`, zone) : null;
  const outAt = d.checkOut ? zonedToInstant(`${d.workDate}T${d.checkOut}`, zone) : null;
  // The shift of the person the row is *for*, not of the HR user typing it.
  const shift = await shiftForUser(user.tenant_id, d.userId);
  const worked = inAt && outAt ? computeWorkedMinutes(inAt, outAt) : 0;
  const overtime = computeOvertimeMinutes(worked, settings, shift);
  const late = inAt ? computeLateMinutes(inAt, settings, user.tenant.timezone, shift) : 0;

  await db`
    INSERT INTO attendance_records
      (tenant_id, user_id, work_date, check_in_at, check_out_at,
       worked_minutes, overtime_minutes, late_minutes, status, source, note)
    VALUES (${user.tenant_id}, ${d.userId}, ${d.workDate},
            ${inAt?.toISOString() ?? null}, ${outAt?.toISOString() ?? null},
            ${worked}, ${overtime}, ${late}, ${d.status}, 'manual', ${d.note ?? null})
    ON CONFLICT (tenant_id, user_id, work_date) DO UPDATE
      SET check_in_at = EXCLUDED.check_in_at,
          check_out_at = EXCLUDED.check_out_at,
          worked_minutes = EXCLUDED.worked_minutes,
          overtime_minutes = EXCLUDED.overtime_minutes,
          late_minutes = EXCLUDED.late_minutes,
          status = EXCLUDED.status,
          source = 'manual',
          note = EXCLUDED.note
  `;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "attendance.manual_entry",
    entity: "attendance",
    summary: `Manual attendance recorded for ${d.workDate}`,
    meta: { targetUserId: d.userId, status: d.status },
  });

  revalidatePath("/attendance");
  return { success: "Attendance recorded." };
}
