"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { DAY_NAMES, workDaysLabel } from "@/lib/work-pattern";
import type { ActionState } from "@/lib/types";

/**
 * The working week, and the shifts that override it.
 *
 * Two levels, deliberately. `tenant_settings` holds the company default —
 * which days are worked, when the day starts, how long it is — and a shift
 * overrides that for the people assigned to it. A company with one pattern
 * never creates a shift; a company with three creates three and assigns
 * them. Every read falls back, so there is no state where somebody has no
 * working pattern at all.
 */

const dayList = z
  .array(z.coerce.number().int().min(0).max(6))
  .transform((days) => [...new Set(days)].sort((a, b) => a - b));

/* --- the company's working week ------------------------------------------- */

/**
 * Stores the days the company *works*.
 *
 * The column is `weekend_days`, so this writes the complement. The screen
 * asks the clearer question — tick the days you work — and a Bangladeshi
 * office ticking Sunday to Thursday gets Friday and Saturday stored, which
 * is the default the column already shipped with.
 */
export async function updateWorkingWeekAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("settings", "edit");
  const parsed = dayList.safeParse(formData.getAll("workDay"));
  if (!parsed.success) return { error: "Those are not valid days." };
  const working = parsed.data;

  if (working.length === 0) {
    return { error: "Tick at least one working day — a week with none would mark everybody absent every day." };
  }
  if (working.length === 7) {
    return {
      error:
        "Every day cannot be a working day: with no rest day, the timesheet would " +
        "show a shortfall for every Friday nobody worked. Leave at least one unticked.",
    };
  }

  const weekend = [0, 1, 2, 3, 4, 5, 6].filter((d) => !working.includes(d));
  const db = await getDb();
  await db`
    UPDATE tenant_settings
       SET weekend_days = ${weekend}, updated_at = now()
     WHERE tenant_id = ${user.tenant_id}
  `;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "settings.working_week",
    summary: `Set the working week to ${workDaysLabel(working)}`,
  });

  revalidatePath("/settings");
  revalidatePath("/me");
  return {
    success: `Working week set to ${workDaysLabel(working)}. Timesheets expect no hours on ${weekend
      .map((d) => DAY_NAMES[d])
      .join(" or ")}.`,
  };
}

/* --- shifts --------------------------------------------------------------- */

const shiftSchema = z.object({
  name: z.string().trim().min(2, "Give the shift a name").max(60),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  breakMinutes: z.coerce.number().int().min(0).max(480),
  graceMinutes: z.union([z.coerce.number().int().min(0).max(240), z.literal("")]).optional(),
});

export async function createShiftAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("settings", "edit");
  const parsed = shiftSchema.safeParse({
    name: formData.get("name"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    breakMinutes: formData.get("breakMinutes") || 0,
    graceMinutes: formData.get("graceMinutes") || "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const days = dayList.safeParse(formData.getAll("workDay"));
  if (!days.success || days.data.length === 0) {
    return { error: "Tick the days this shift works." };
  }
  const d = parsed.data;

  if (d.startTime === d.endTime) {
    return { error: "A shift cannot start and end at the same minute." };
  }

  const db = await getDb();
  const clash = await db`
    SELECT 1 FROM shifts
     WHERE tenant_id = ${user.tenant_id} AND LOWER(name) = LOWER(${d.name})
  `;
  if (clash.length > 0) {
    return { fieldErrors: { name: ["There is already a shift with that name."] } };
  }

  await db`
    INSERT INTO shifts (tenant_id, name, start_time, end_time, break_minutes,
                        work_days, grace_minutes)
    VALUES (${user.tenant_id}, ${d.name}, ${d.startTime}, ${d.endTime},
            ${d.breakMinutes}, ${days.data},
            ${d.graceMinutes === "" || d.graceMinutes === undefined ? null : d.graceMinutes})
  `;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "shift.create",
    entity: "shift",
    summary: `Created the shift "${d.name}" (${d.startTime}–${d.endTime}, ${workDaysLabel(days.data)})`,
  });

  revalidatePath("/settings");
  return { success: `Shift "${d.name}" created. Assign people to it below.` };
}

export async function deleteShiftAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("settings", "edit");
  const id = z.string().uuid().safeParse(formData.get("shiftId"));
  if (!id.success) return { error: "Invalid request." };

  const db = await getDb();
  // Scoped to the tenant: the id arrives from the client and must never be
  // trusted to belong to this company.
  const removed = await db`
    DELETE FROM shifts
     WHERE id = ${id.data} AND tenant_id = ${user.tenant_id}
    RETURNING name
  `;
  if (removed.length === 0) return { error: "That shift no longer exists." };
  const name = (removed[0] as { name: string }).name;

  // users.shift_id is ON DELETE SET NULL, so everybody on it falls back to
  // the company default rather than losing their account.
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "shift.delete",
    entity: "shift",
    summary: `Deleted the shift "${name}"; anyone on it now follows the company default`,
  });

  revalidatePath("/settings");
  return { success: `Deleted "${name}". Anyone on it now follows the company default.` };
}

const assignSchema = z.object({
  userId: z.string().uuid(),
  /** "" means "take them off every shift". */
  shiftId: z.union([z.string().uuid(), z.literal("")]),
});

export async function assignShiftAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("settings", "edit");
  const parsed = assignSchema.safeParse({
    userId: formData.get("userId"),
    shiftId: formData.get("shiftId") ?? "",
  });
  if (!parsed.success) return { error: "Invalid request." };
  const { userId, shiftId } = parsed.data;

  const db = await getDb();
  if (shiftId) {
    const owned = await db`
      SELECT 1 FROM shifts WHERE id = ${shiftId} AND tenant_id = ${user.tenant_id}
    `;
    if (owned.length === 0) return { error: "That shift does not belong to your company." };
  }

  const updated = await db`
    UPDATE users SET shift_id = ${shiftId || null}, updated_at = now()
     WHERE id = ${userId} AND tenant_id = ${user.tenant_id}
    RETURNING full_name
  `;
  if (updated.length === 0) return { error: "Employee not found." };
  const name = (updated[0] as { full_name: string }).full_name;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "shift.assign",
    entity: "user",
    entityId: userId,
    summary: shiftId
      ? `Put ${name} on a shift`
      : `Took ${name} off their shift; they follow the company default`,
  });

  revalidatePath("/settings");
  revalidatePath("/me");
  return {
    success: shiftId
      ? `${name} is on that shift. Their timesheet uses its hours from today.`
      : `${name} follows the company default again.`,
  };
}
