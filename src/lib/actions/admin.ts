"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  requireCompanyAdmin,
  requirePermission,
  requirePlatformAdmin,
} from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { ActionState } from "@/lib/types";

/* --- notifications -------------------------------------------------------- */

export async function markNotificationsReadAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const id = String(formData.get("notificationId") ?? "");
  const db = await getDb();

  if (id === "all") {
    await db`
      UPDATE notifications SET read_at = now()
       WHERE tenant_id = ${user.tenant_id} AND user_id = ${user.id} AND read_at IS NULL
    `;
  } else {
    await db`
      UPDATE notifications SET read_at = now()
       WHERE id = ${id} AND tenant_id = ${user.tenant_id} AND user_id = ${user.id}
    `;
  }
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  return { success: "Marked as read." };
}

/* --- company settings ----------------------------------------------------- */

const settingsSchema = z.object({
  standardWorkMinutes: z.coerce.number().int().min(60).max(1440),
  workStartTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  graceMinutes: z.coerce.number().int().min(0).max(240),
  overtimeAfterMinutes: z.coerce.number().int().min(60).max(1440),
  overtimeMultiplier: z.coerce.number().min(1).max(5),
  attendanceRadiusMeters: z.coerce.number().int().min(20).max(50_000),
  requireGeofencedCheckin: z.coerce.boolean().optional(),
  telemetryIntervalSeconds: z.coerce.number().int().min(15).max(3600),
  telemetryRetentionDays: z.coerce.number().int().min(1).max(3650),
  trackingWindowStart: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  trackingWindowEnd: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  deviationThresholdMeters: z.coerce.number().int().min(100).max(500_000),
  invoicePrefix: z.string().trim().min(1).max(10),
  poPrefix: z.string().trim().min(1).max(10),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
});

export async function updateSettingsAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("settings", "edit");
  const get = (k: string) => (formData.get(k) ?? "") as string;
  const parsed = settingsSchema.safeParse({
    standardWorkMinutes: get("standardWorkMinutes") || 480,
    workStartTime: get("workStartTime") || "09:00",
    graceMinutes: get("graceMinutes") || 15,
    overtimeAfterMinutes: get("overtimeAfterMinutes") || 480,
    overtimeMultiplier: get("overtimeMultiplier") || 1.5,
    attendanceRadiusMeters: get("attendanceRadiusMeters") || 200,
    requireGeofencedCheckin: get("requireGeofencedCheckin") === "on",
    telemetryIntervalSeconds: get("telemetryIntervalSeconds") || 60,
    telemetryRetentionDays: get("telemetryRetentionDays") || 90,
    trackingWindowStart: get("trackingWindowStart") || "07:00",
    trackingWindowEnd: get("trackingWindowEnd") || "21:00",
    deviationThresholdMeters: get("deviationThresholdMeters") || 1000,
    invoicePrefix: get("invoicePrefix") || "INV",
    poPrefix: get("poPrefix") || "PO",
    fiscalYearStartMonth: get("fiscalYearStartMonth") || 7,
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  await db`
    UPDATE tenant_settings
       SET standard_work_minutes = ${d.standardWorkMinutes},
           work_start_time = ${d.workStartTime},
           grace_minutes = ${d.graceMinutes},
           overtime_after_minutes = ${d.overtimeAfterMinutes},
           overtime_multiplier = ${d.overtimeMultiplier},
           attendance_radius_meters = ${d.attendanceRadiusMeters},
           require_geofenced_checkin = ${d.requireGeofencedCheckin ?? false},
           telemetry_interval_seconds = ${d.telemetryIntervalSeconds},
           telemetry_retention_days = ${d.telemetryRetentionDays},
           tracking_window_start = ${d.trackingWindowStart},
           tracking_window_end = ${d.trackingWindowEnd},
           deviation_threshold_meters = ${d.deviationThresholdMeters},
           invoice_prefix = ${d.invoicePrefix.toUpperCase()},
           po_prefix = ${d.poPrefix.toUpperCase()},
           fiscal_year_start_month = ${d.fiscalYearStartMonth},
           updated_at = now()
     WHERE tenant_id = ${user.tenant_id}
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "settings.updated",
    summary: "Updated company settings",
  });
  revalidatePath("/settings");
  return { success: "Settings saved. New values apply from the next check-in or document." };
}

const approvalSchema = z.object({
  leaveStages: z.string().trim().max(200),
  tier1Role: z.string().trim().max(40),
  tier2Amount: z.coerce.number().min(0).max(1_000_000_000),
  tier2Role: z.string().trim().max(40),
  tier3Amount: z.coerce.number().min(0).max(1_000_000_000),
  tier3Role: z.string().trim().max(40),
});

/** Edits the leave chain and the purchase-order approval thresholds. */
export async function updateApprovalsAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("settings", "edit");
  const parsed = approvalSchema.safeParse({
    leaveStages: formData.get("leaveStages") ?? "line_manager,hr_manager",
    tier1Role: formData.get("tier1Role") ?? "procurement_manager",
    tier2Amount: formData.get("tier2Amount") || 0,
    tier2Role: formData.get("tier2Role") ?? "",
    tier3Amount: formData.get("tier3Amount") || 0,
    tier3Role: formData.get("tier3Role") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;

  const stages = d.leaveStages
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (stages.length === 0) {
    return { fieldErrors: { leaveStages: ["Name at least one approval stage."] } };
  }

  const tiers = [
    { amount: 0, role: d.tier1Role || "procurement_manager" },
    ...(d.tier2Role ? [{ amount: d.tier2Amount, role: d.tier2Role }] : []),
    ...(d.tier3Role ? [{ amount: d.tier3Amount, role: d.tier3Role }] : []),
  ].sort((a, b) => a.amount - b.amount);

  const db = await getDb();
  await db`
    UPDATE tenant_settings
       SET leave_approval_stages = ${JSON.stringify(stages)}::jsonb,
           po_approval_tiers = ${JSON.stringify(tiers)}::jsonb,
           updated_at = now()
     WHERE tenant_id = ${user.tenant_id}
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "settings.approvals_updated",
    summary: `Leave chain: ${stages.join(" → ")}; ${tiers.length} PO tier(s)`,
  });
  revalidatePath("/settings");
  return { success: "Approval rules saved. They apply to requests raised from now on." };
}

export async function updateCompanyAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireCompanyAdmin();
  const parsed = z
    .object({
      companyName: z.string().trim().min(2, "Company name is required").max(160),
      email: z.string().trim().max(160).optional(),
      phone: z.string().trim().max(32).optional(),
      address: z.string().trim().max(400).optional(),
      country: z.string().trim().max(80).optional(),
      currency: z.string().trim().length(3),
      timezone: z.string().trim().max(60),
    })
    .safeParse({
      companyName: formData.get("companyName") ?? "",
      email: formData.get("email") || undefined,
      phone: formData.get("phone") || undefined,
      address: formData.get("address") || undefined,
      country: formData.get("country") || undefined,
      currency: formData.get("currency") || "BDT",
      timezone: formData.get("timezone") || "Asia/Dhaka",
    });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  await db`
    UPDATE tenants
       SET company_name = ${d.companyName}, email = ${d.email ?? null},
           phone = ${d.phone ?? null}, address = ${d.address ?? null},
           country = ${d.country ?? null}, currency = ${d.currency.toUpperCase()},
           timezone = ${d.timezone}, updated_at = now()
     WHERE id = ${user.tenant_id}
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "tenant.updated",
    summary: "Updated company profile",
  });
  revalidatePath("/settings");
  return { success: "Company profile saved." };
}

/* --- platform operator ---------------------------------------------------- */

export async function setTenantStatusAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const operator = await requirePlatformAdmin();
  const parsed = z
    .object({
      tenantId: z.string().uuid(),
      status: z.enum(["trial", "active", "suspended", "cancelled"]),
    })
    .safeParse({
      tenantId: formData.get("tenantId"),
      status: formData.get("status"),
    });
  if (!parsed.success) return { error: "Invalid request." };
  const db = await getDb();

  const updated = await db`
    UPDATE tenants SET status = ${parsed.data.status}, updated_at = now()
     WHERE id = ${parsed.data.tenantId}
    RETURNING company_name
    -- tenancy-ok: the platform operator acts across tenants by definition
  `;
  if (updated.length === 0) return { error: "Company not found." };

  // Suspension takes effect immediately rather than at cookie expiry.
  if (parsed.data.status === "suspended" || parsed.data.status === "cancelled") {
    await db`DELETE FROM sessions WHERE tenant_id = ${parsed.data.tenantId}
             -- tenancy-ok: revoking a suspended tenant's live sessions`;
  }

  await audit({
    tenantId: parsed.data.tenantId,
    userId: operator.id,
    action: "platform.tenant_status",
    entity: "tenant",
    entityId: parsed.data.tenantId,
    summary: `${(updated[0] as { company_name: string }).company_name} set to ${parsed.data.status} by the platform operator`,
  });
  revalidatePath("/platform");
  return { success: `Company set to ${parsed.data.status}.` };
}
