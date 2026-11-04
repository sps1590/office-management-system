"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { enrolDevice, purgeOldTelemetry } from "@/lib/telemetry";
import { audit } from "@/lib/audit";
import type { ActionState } from "@/lib/types";

const geofenceSchema = z
  .object({
    name: z.string().trim().min(2, "Give the fence a name").max(120),
    kind: z.enum(["office", "territory", "client", "warehouse", "route", "restricted"]),
    centerLat: z.coerce.number().min(-90).max(90),
    centerLng: z.coerce.number().min(-180).max(180),
    radiusMeters: z.coerce.number().int().min(20).max(500_000),
    color: z.string().trim().max(9).optional(),
    alertOnEnter: z.coerce.boolean().optional(),
    alertOnExit: z.coerce.boolean().optional(),
  })
  .refine((v) => v.centerLat !== 0 || v.centerLng !== 0, {
    message: "Enter the centre coordinates",
    path: ["centerLat"],
  });

/**
 * Circular fences only from the UI: a radius around a point covers offices,
 * warehouses and sales territories, and can be typed in by hand. Polygon
 * fences are supported by the schema and the engine for import from a GIS
 * file, which has no UI yet.
 */
export async function createGeofenceAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("tracking", "create");
  const parsed = geofenceSchema.safeParse({
    name: formData.get("name") ?? "",
    kind: formData.get("kind") || "office",
    centerLat: formData.get("centerLat") || 0,
    centerLng: formData.get("centerLng") || 0,
    radiusMeters: formData.get("radiusMeters") || 200,
    color: formData.get("color") || "#6366f1",
    alertOnEnter: formData.get("alertOnEnter") === "on",
    alertOnExit: formData.get("alertOnExit") === "on",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const clash = await db`
    SELECT 1 FROM geofences WHERE tenant_id = ${user.tenant_id} AND name = ${d.name}
  `;
  if (clash.length > 0) {
    return { fieldErrors: { name: ["A geofence with that name already exists."] } };
  }

  await db`
    INSERT INTO geofences (tenant_id, name, kind, shape, center_lat, center_lng,
                           radius_meters, color, alert_on_enter, alert_on_exit, is_active)
    VALUES (${user.tenant_id}, ${d.name}, ${d.kind}, 'circle', ${d.centerLat},
            ${d.centerLng}, ${d.radiusMeters}, ${d.color ?? "#6366f1"},
            ${d.alertOnEnter ?? false}, ${d.alertOnExit ?? false}, TRUE)
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "geofence.created",
    entity: "geofence",
    summary: `Created ${d.kind} geofence ${d.name} (${d.radiusMeters} m)`,
  });
  revalidatePath("/tracking");
  return {
    success: `${d.name} created. Assign it to the people it should apply to — an unassigned fence is drawn on the map but raises no alerts.`,
  };
}

export async function assignGeofenceAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("tracking", "edit");
  const parsed = z
    .object({ geofenceId: z.string().uuid(), userId: z.string().uuid() })
    .safeParse({
      geofenceId: formData.get("geofenceId"),
      userId: formData.get("userId"),
    });
  if (!parsed.success) return { error: "Invalid request." };
  const db = await getDb();

  const [fence, target] = await Promise.all([
    db`SELECT name FROM geofences WHERE id = ${parsed.data.geofenceId} AND tenant_id = ${user.tenant_id}`,
    db`SELECT full_name FROM users WHERE id = ${parsed.data.userId} AND tenant_id = ${user.tenant_id}`,
  ]);
  if (fence.length === 0 || target.length === 0) {
    return { error: "Geofence or employee not found." };
  }

  await db`
    INSERT INTO geofence_assignments (tenant_id, geofence_id, user_id)
    VALUES (${user.tenant_id}, ${parsed.data.geofenceId}, ${parsed.data.userId})
    ON CONFLICT (geofence_id, user_id) DO NOTHING
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "geofence.assigned",
    entity: "geofence",
    entityId: parsed.data.geofenceId,
    summary: `Assigned ${(fence[0] as { name: string }).name} to ${(target[0] as { full_name: string }).full_name}`,
  });
  revalidatePath("/tracking");
  return { success: "Assigned." };
}

export async function toggleGeofenceAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("tracking", "edit");
  const geofenceId = String(formData.get("geofenceId") ?? "");
  const db = await getDb();

  const updated = await db`
    UPDATE geofences SET is_active = NOT is_active
     WHERE id = ${geofenceId} AND tenant_id = ${user.tenant_id}
    RETURNING name, is_active
  `;
  if (updated.length === 0) return { error: "Geofence not found." };
  const row = updated[0] as { name: string; is_active: boolean };

  revalidatePath("/tracking");
  return { success: `${row.name} ${row.is_active ? "activated" : "deactivated"}.` };
}

export async function revokeDeviceAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("tracking", "edit");
  const deviceId = String(formData.get("deviceId") ?? "");
  const db = await getDb();

  // Deactivating rather than deleting keeps the history of what reported what,
  // while the token stops working immediately.
  const updated = await db`
    UPDATE device_registrations SET is_active = FALSE
     WHERE id = ${deviceId} AND tenant_id = ${user.tenant_id}
    RETURNING device_id
  `;
  if (updated.length === 0) return { error: "Device not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "device.revoked",
    entity: "device_registration",
    entityId: deviceId,
    summary: `Revoked device ${(updated[0] as { device_id: string }).device_id}`,
  });
  revalidatePath("/tracking");
  return { success: "Device revoked. Its token no longer works." };
}

/** Applies the tenant's retention limit to stored telemetry. */
export async function purgeTelemetryAction(
  _prev: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("tracking", "delete");
  const removed = await purgeOldTelemetry(user.tenant_id);
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "telemetry.purged",
    summary: `Purged ${removed} location rows past the retention limit`,
  });
  revalidatePath("/tracking");
  return {
    success:
      removed === 0
        ? "Nothing was past the retention limit."
        : `Removed ${removed} location rows older than the retention limit.`,
  };
}

/**
 * Enrols the browser as a tracking device for the signed-in user, so the PWA
 * tracker page can post to the same ingest endpoint a native client uses.
 * Returns the token to the caller once; it is stored only as a hash.
 */
export async function enrolBrowserAction(): Promise<{
  token?: string;
  intervalSeconds?: number;
  error?: string;
}> {
  const user = await requireUser();
  try {
    const { token, intervalSeconds } = await enrolDevice({
      tenantId: user.tenant_id,
      userId: user.id,
      deviceId: `web-${user.id}`,
      platform: "web",
      model: "Browser (PWA tracker)",
      mdmEnrolled: false,
    });
    await audit({
      tenantId: user.tenant_id,
      userId: user.id,
      action: "device.enrolled",
      summary: "Enrolled browser as a tracking device",
    });
    return { token, intervalSeconds };
  } catch {
    return { error: "Could not start tracking. Try again." };
  }
}
