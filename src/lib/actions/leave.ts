"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { audit, notify } from "@/lib/audit";
import { daysBetween } from "@/lib/utils";
import { countOf, stillInUse } from "@/lib/guards";
import type { ActionState } from "@/lib/types";

const requestSchema = z
  .object({
    leaveTypeId: z.string().uuid("Choose a leave type"),
    startDate: z.string().min(10, "Pick a start date"),
    endDate: z.string().min(10, "Pick an end date"),
    reason: z.string().trim().max(600).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "The end date cannot be before the start date",
    path: ["endDate"],
  });

/**
 * Resolves the approval chain for one employee from
 * `tenant_settings.leave_approval_stages` — a list such as
 * ["line_manager", "hr_manager"] (SRS 3.4: Employee → Line Manager → HR).
 *
 * "line_manager" resolves to the employee's own manager; anything else is
 * treated as a role key and resolves to a holder of that role. Stages that
 * resolve to nobody are dropped, so a company with no HR manager yet still
 * gets a workable one-stage chain rather than a request stuck forever.
 */
async function resolveApprovalChain(
  tenantId: string,
  employeeId: string,
  stages: string[]
): Promise<{ stage: number; approverId: string; role: string }[]> {
  const db = await getDb();
  const chain: { stage: number; approverId: string; role: string }[] = [];

  const empRows = await db`
    SELECT line_manager_id FROM users
     WHERE id = ${employeeId} AND tenant_id = ${tenantId}
  `;
  const lineManagerId =
    (empRows[0] as { line_manager_id: string | null } | undefined)?.line_manager_id ?? null;

  for (const stageKey of stages) {
    let approverId: string | null = null;

    if (stageKey === "line_manager") {
      approverId = lineManagerId;
    } else {
      const rows = await db`
        SELECT u.id FROM users u
          JOIN roles r ON r.id = u.role_id
         WHERE u.tenant_id = ${tenantId} AND u.status = 'active' AND r.key = ${stageKey}
         ORDER BY u.created_at
         LIMIT 1
      `;
      approverId = (rows[0] as { id: string } | undefined)?.id ?? null;
    }

    // Nobody approves their own leave: skip a stage that resolves to the
    // requester and let the next stage handle it.
    if (!approverId || approverId === employeeId) continue;
    if (chain.some((c) => c.approverId === approverId)) continue;

    chain.push({ stage: chain.length + 1, approverId, role: stageKey });
  }

  // Last resort: a company admin, so a request is never un-approvable.
  if (chain.length === 0) {
    const rows = await db`
      SELECT u.id FROM users u
        JOIN roles r ON r.id = u.role_id
       WHERE u.tenant_id = ${tenantId} AND u.status = 'active'
         AND r.key = 'company_admin' AND u.id <> ${employeeId}
       ORDER BY u.created_at
       LIMIT 1
    `;
    const fallback = (rows[0] as { id: string } | undefined)?.id;
    if (fallback) chain.push({ stage: 1, approverId: fallback, role: "company_admin" });
  }

  return chain;
}

export async function requestLeaveAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = requestSchema.safeParse({
    leaveTypeId: formData.get("leaveTypeId"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();
  const settings = await getSettings(user.tenant_id);

  const type = await db`
    SELECT id, name, annual_quota::float AS annual_quota FROM leave_types
     WHERE id = ${d.leaveTypeId} AND tenant_id = ${user.tenant_id} AND is_active = TRUE
  `;
  const leaveType = type[0] as
    | { id: string; name: string; annual_quota: number }
    | undefined;
  if (!leaveType) return { error: "That leave type is not available." };

  const days = daysBetween(d.startDate, d.endDate);
  if (days <= 0 || days > 365) return { error: "That date range is not valid." };

  // Reject an overlap with an existing live request rather than quietly
  // double-counting the same days.
  const overlap = await db`
    SELECT 1 FROM leave_requests
     WHERE tenant_id = ${user.tenant_id} AND user_id = ${user.id}
       AND status IN ('pending','approved')
       AND start_date <= ${d.endDate} AND end_date >= ${d.startDate}
  `;
  if (overlap.length > 0) {
    return { error: "You already have a leave request covering some of those dates." };
  }

  const year = Number(d.startDate.slice(0, 4));
  const used = await db`
    SELECT COALESCE(SUM(days), 0)::float AS taken FROM leave_requests
     WHERE tenant_id = ${user.tenant_id} AND user_id = ${user.id}
       AND leave_type_id = ${d.leaveTypeId} AND status = 'approved'
       AND EXTRACT(YEAR FROM start_date) = ${year}
  `;
  const taken = (used[0] as { taken: number }).taken;
  if (leaveType.annual_quota > 0 && taken + days > leaveType.annual_quota) {
    return {
      error: `That exceeds your ${leaveType.name} entitlement: ${taken} of ${leaveType.annual_quota} days already used this year.`,
    };
  }

  const chain = await resolveApprovalChain(
    user.tenant_id,
    user.id,
    settings.leave_approval_stages
  );
  if (chain.length === 0) {
    return {
      error:
        "No approver could be found. Ask your administrator to set a line manager or an HR manager.",
    };
  }

  const inserted = await db`
    INSERT INTO leave_requests
      (tenant_id, user_id, leave_type_id, start_date, end_date, days, reason,
       status, current_stage, total_stages)
    VALUES (${user.tenant_id}, ${user.id}, ${d.leaveTypeId}, ${d.startDate},
            ${d.endDate}, ${days}, ${d.reason ?? null}, 'pending', 1, ${chain.length})
    RETURNING id
  `;
  const requestId = (inserted[0] as { id: string }).id;

  // Every stage is created up front, so the whole chain is visible before
  // anyone has acted on it.
  for (const step of chain) {
    await db`
      INSERT INTO leave_approvals
        (tenant_id, leave_request_id, approver_id, approver_role, stage, decision)
      VALUES (${user.tenant_id}, ${requestId}, ${step.approverId}, ${step.role},
              ${step.stage}, 'pending')
    `;
  }

  await notify({
    tenantId: user.tenant_id,
    userId: chain[0].approverId,
    title: "Leave request to approve",
    body: `${user.full_name} requested ${days} day(s) of ${leaveType.name}.`,
    kind: "approval",
    severity: "high",
    link: "/leave",
    entity: "leave_request",
    entityId: requestId,
  });
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "leave.requested",
    entity: "leave_request",
    entityId: requestId,
    summary: `Requested ${days} day(s) of ${leaveType.name}`,
  });

  revalidatePath("/leave");
  return {
    success: `Request submitted — ${chain.length} approval stage${
      chain.length === 1 ? "" : "s"
    }.`,
  };
}

const decideSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  comments: z.string().trim().max(600).optional(),
});

/**
 * Records one stage's decision. Approval advances to the next stage; the last
 * stage marks the request approved and writes `on_leave` attendance rows for
 * every covered day so the register and payroll agree. A rejection at any
 * stage ends the request.
 */
export async function decideLeaveAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = decideSchema.safeParse({
    requestId: formData.get("requestId"),
    decision: formData.get("decision"),
    comments: formData.get("comments") || undefined,
  });
  if (!parsed.success) return { error: "Invalid request." };
  const { requestId, decision, comments } = parsed.data;
  const db = await getDb();

  const rows = await db`
    SELECT lr.id, lr.user_id, lr.status, lr.current_stage, lr.total_stages,
           lr.start_date, lr.end_date, lr.days,
           lt.name AS leave_type, u.full_name
      FROM leave_requests lr
      JOIN leave_types lt ON lt.id = lr.leave_type_id
      JOIN users u        ON u.id = lr.user_id
     WHERE lr.id = ${requestId} AND lr.tenant_id = ${user.tenant_id}
  `;
  const req = rows[0] as
    | {
        id: string;
        user_id: string;
        status: string;
        current_stage: number;
        total_stages: number;
        start_date: string;
        end_date: string;
        days: number;
        leave_type: string;
        full_name: string;
      }
    | undefined;
  if (!req) return { error: "Request not found." };
  if (req.status !== "pending") return { error: "That request has already been decided." };

  const stageRows = await db`
    SELECT id, approver_id FROM leave_approvals
     WHERE tenant_id = ${user.tenant_id} AND leave_request_id = ${requestId}
       AND stage = ${req.current_stage}
  `;
  const stage = stageRows[0] as { id: string; approver_id: string | null } | undefined;
  if (!stage) return { error: "This request has no pending approval stage." };

  // The named approver decides. Someone with leave.approve may act in their
  // place (an escalation path for absence), but never on their own request.
  const isNamedApprover = stage.approver_id === user.id;
  const canOverride = hasPermission(user, "leave", "approve");
  if (!isNamedApprover && !canOverride) {
    return { error: "This request is waiting on someone else." };
  }
  if (req.user_id === user.id) {
    return { error: "You cannot decide your own leave request." };
  }

  await db`
    UPDATE leave_approvals
       SET decision = ${decision}, comments = ${comments ?? null},
           decided_at = now(), approver_id = ${stage.approver_id ?? user.id}
     WHERE id = ${stage.id} AND tenant_id = ${user.tenant_id}
  `;

  if (decision === "rejected") {
    await db`
      UPDATE leave_requests SET status = 'rejected', decided_at = now()
       WHERE id = ${requestId} AND tenant_id = ${user.tenant_id}
    `;
    await notify({
      tenantId: user.tenant_id,
      userId: req.user_id,
      title: "Leave request declined",
      body: `Your ${req.leave_type} request was declined${comments ? `: ${comments}` : "."}`,
      severity: "high",
      link: "/leave",
    });
  } else if (req.current_stage >= req.total_stages) {
    await db`
      UPDATE leave_requests SET status = 'approved', decided_at = now()
       WHERE id = ${requestId} AND tenant_id = ${user.tenant_id}
    `;
    // Mark the register, so an approved absence is not later counted absent.
    await db`
      INSERT INTO attendance_records (tenant_id, user_id, work_date, status, source, note)
      SELECT ${user.tenant_id}, ${req.user_id}, d::date, 'on_leave', 'manual',
             ${`Approved ${req.leave_type}`}
        FROM generate_series(${req.start_date}::date, ${req.end_date}::date, '1 day') AS d
      ON CONFLICT (tenant_id, user_id, work_date) DO UPDATE
        SET status = 'on_leave', note = EXCLUDED.note
        WHERE attendance_records.check_in_at IS NULL
    `;
    await notify({
      tenantId: user.tenant_id,
      userId: req.user_id,
      title: "Leave approved",
      body: `Your ${req.days} day(s) of ${req.leave_type} is approved.`,
      link: "/leave",
    });
  } else {
    const next = req.current_stage + 1;
    await db`
      UPDATE leave_requests SET current_stage = ${next}
       WHERE id = ${requestId} AND tenant_id = ${user.tenant_id}
    `;
    const nextRows = await db`
      SELECT approver_id FROM leave_approvals
       WHERE tenant_id = ${user.tenant_id} AND leave_request_id = ${requestId}
         AND stage = ${next}
    `;
    const nextApprover = (nextRows[0] as { approver_id: string | null } | undefined)
      ?.approver_id;
    if (nextApprover) {
      await notify({
        tenantId: user.tenant_id,
        userId: nextApprover,
        title: "Leave request to approve",
        body: `${req.full_name} — ${req.days} day(s) of ${req.leave_type}, stage ${next} of ${req.total_stages}.`,
        kind: "approval",
        severity: "high",
        link: "/leave",
      });
    }
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: `leave.${decision}`,
    entity: "leave_request",
    entityId: requestId,
    summary: `${decision === "approved" ? "Approved" : "Declined"} ${req.full_name}'s ${
      req.leave_type
    } (stage ${req.current_stage}/${req.total_stages})`,
  });

  revalidatePath("/leave");
  revalidatePath("/dashboard");
  return { success: decision === "approved" ? "Approved." : "Declined." };
}

export async function cancelLeaveAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const requestId = String(formData.get("requestId") ?? "");
  const db = await getDb();

  const rows = await db`
    SELECT user_id, status FROM leave_requests
     WHERE id = ${requestId} AND tenant_id = ${user.tenant_id}
  `;
  const req = rows[0] as { user_id: string; status: string } | undefined;
  if (!req) return { error: "Request not found." };
  if (req.user_id !== user.id && !hasPermission(user, "leave", "edit")) {
    return { error: "You can only cancel your own request." };
  }
  if (req.status === "approved") {
    return { error: "An approved request must be reversed by HR, not cancelled." };
  }

  await db`
    UPDATE leave_requests SET status = 'cancelled', decided_at = now()
     WHERE id = ${requestId} AND tenant_id = ${user.tenant_id}
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "leave.cancelled",
    entity: "leave_request",
    entityId: requestId,
    summary: "Cancelled a leave request",
  });
  revalidatePath("/leave");
  return { success: "Request cancelled." };
}

const leaveTypeSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(60),
  annualQuota: z.coerce.number().min(0).max(400),
  isPaid: z.coerce.boolean().optional(),
  color: z.string().trim().max(9).optional(),
});

export async function createLeaveTypeAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("leave", "create");
  const parsed = leaveTypeSchema.safeParse({
    name: formData.get("name"),
    annualQuota: formData.get("annualQuota") || 0,
    isPaid: formData.get("isPaid") === "on",
    color: formData.get("color") || "#6366f1",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const key = d.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
  const db = await getDb();

  const clash = await db`
    SELECT 1 FROM leave_types WHERE tenant_id = ${user.tenant_id} AND key = ${key}
  `;
  if (clash.length > 0) {
    return { fieldErrors: { name: ["A leave type with a similar name already exists."] } };
  }

  await db`
    INSERT INTO leave_types (tenant_id, key, name, annual_quota, is_paid, color, sort_order)
    VALUES (${user.tenant_id}, ${key}, ${d.name}, ${d.annualQuota}, ${d.isPaid ?? true},
            ${d.color ?? "#6366f1"},
            (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM leave_types WHERE tenant_id = ${user.tenant_id}))
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "leave_type.created",
    entity: "leave_type",
    summary: `Added leave type ${d.name}`,
  });
  revalidatePath("/leave");
  return { success: `Leave type "${d.name}" added.` };
}

/* --- leave types and the company calendar -------------------------------- */

const editLeaveTypeSchema = z.object({
  leaveTypeId: z.string().uuid(),
  name: z.string().trim().min(2, "Name is required").max(60),
  annualQuota: z.coerce.number().min(0).max(400),
  isPaid: z.coerce.boolean().optional(),
  color: z.string().trim().max(9).optional(),
  isActive: z.coerce.boolean().optional(),
});

/**
 * Edits a leave type in place.
 *
 * `key` is deliberately not editable. It is the stable handle the seeded
 * types are found by and the spreadsheet importer matches on; renaming a
 * type should change what people read, not break what refers to it.
 */
export async function updateLeaveTypeAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("leave", "edit");
  const parsed = editLeaveTypeSchema.safeParse({
    leaveTypeId: formData.get("leaveTypeId"),
    name: formData.get("name"),
    annualQuota: formData.get("annualQuota") || 0,
    isPaid: formData.get("isPaid") === "on",
    color: formData.get("color") || "#6366f1",
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const clash = await db`
    SELECT 1 FROM leave_types
     WHERE tenant_id = ${user.tenant_id} AND lower(name) = lower(${d.name})
       AND id <> ${d.leaveTypeId}
  `;
  if (clash.length > 0) {
    return { fieldErrors: { name: ["Another leave type already has that name."] } };
  }

  const updated = await db`
    UPDATE leave_types
       SET name = ${d.name}, annual_quota = ${d.annualQuota}, is_paid = ${d.isPaid ?? false},
           color = ${d.color ?? "#6366f1"}, is_active = ${d.isActive ?? false}
     WHERE id = ${d.leaveTypeId} AND tenant_id = ${user.tenant_id}
    RETURNING name
  `;
  if (updated.length === 0) return { error: "Leave type not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "leave_type.updated",
    entity: "leave_type",
    entityId: d.leaveTypeId,
    summary: `Updated leave type ${d.name}`,
  });
  revalidatePath("/leave");
  return { success: "Leave type updated." };
}

export async function deleteLeaveTypeAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("leave", "edit");
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid request." };
  const db = await getDb();

  /*
     `leave_requests.leave_type_id` is ON DELETE RESTRICT, so the database
     would raise rather than cascade — but a foreign-key violation reaches
     the screen as "something went wrong". Counting first turns it into a
     sentence that says what to do. Balances cascade, and a balance is an
     entitlement somebody is owed, so those are counted too.
  */
  const [requests, balances] = await Promise.all([
    db`SELECT COUNT(*)::int AS n FROM leave_requests WHERE tenant_id = ${user.tenant_id} AND leave_type_id = ${id}`,
    db`SELECT COUNT(*)::int AS n FROM leave_balances WHERE tenant_id = ${user.tenant_id} AND leave_type_id = ${id}`,
  ]);
  const blocked = stillInUse(
    [
      { n: countOf(requests), label: "leave request" },
      { n: countOf(balances), label: "entitlement" },
    ],
    "Untick “Active” on it instead: it stays on past records and disappears from the request form."
  );
  if (blocked) return { error: blocked };

  const gone = await db`
    DELETE FROM leave_types WHERE id = ${id} AND tenant_id = ${user.tenant_id}
    RETURNING name
  `;
  if (gone.length === 0) return { error: "Leave type not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "leave_type.deleted",
    entity: "leave_type",
    entityId: id,
    summary: `Deleted the unused leave type ${(gone[0] as { name: string }).name}`,
  });
  revalidatePath("/leave");
  return { success: "Leave type deleted." };
}

const holidaySchema = z.object({
  holidayId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  name: z.string().trim().min(2, "Name is required").max(120),
  isRecurring: z.coerce.boolean().optional(),
});

/**
 * The company's public holidays.
 *
 * The table has existed since the first schema and until now nothing could
 * put a row in it — the timesheet and the leave calendar both read it and
 * both always found it empty.
 */
export async function saveHolidayAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("leave", "edit");
  const parsed = holidaySchema.safeParse({
    holidayId: formData.get("holidayId") || undefined,
    date: formData.get("date"),
    name: formData.get("name"),
    isRecurring: formData.get("isRecurring") === "on",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  if (d.holidayId) {
    const updated = await db`
      UPDATE holidays SET holiday_date = ${d.date}, name = ${d.name},
                          is_recurring = ${d.isRecurring ?? false}
       WHERE id = ${d.holidayId} AND tenant_id = ${user.tenant_id}
      RETURNING name
    `;
    if (updated.length === 0) return { error: "Holiday not found." };
  } else {
    // One holiday per date, which the table's own unique constraint already
    // says; ON CONFLICT turns a second entry for the same day into a rename
    // rather than an error nobody can act on.
    await db`
      INSERT INTO holidays (tenant_id, holiday_date, name, is_recurring)
      VALUES (${user.tenant_id}, ${d.date}, ${d.name}, ${d.isRecurring ?? false})
      ON CONFLICT (tenant_id, holiday_date)
        DO UPDATE SET name = EXCLUDED.name, is_recurring = EXCLUDED.is_recurring
    `;
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: d.holidayId ? "holiday.updated" : "holiday.created",
    entity: "holiday",
    entityId: d.holidayId ?? null,
    summary: `${d.holidayId ? "Updated" : "Added"} the holiday ${d.name} on ${d.date}`,
  });
  revalidatePath("/leave");
  revalidatePath("/me");
  return { success: d.holidayId ? "Holiday updated." : "Holiday added." };
}

export async function deleteHolidayAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("leave", "edit");
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid request." };

  const db = await getDb();
  // Nothing references a holiday; the timesheet reads it by date. So this is
  // one of the few rows in the product that is safe to simply remove.
  const gone = await db`
    DELETE FROM holidays WHERE id = ${id} AND tenant_id = ${user.tenant_id}
    RETURNING name, holiday_date
  `;
  if (gone.length === 0) return { error: "Holiday not found." };
  const h = gone[0] as { name: string; holiday_date: string };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "holiday.deleted",
    entity: "holiday",
    entityId: id,
    summary: `Removed the holiday ${h.name} on ${h.holiday_date}`,
  });
  revalidatePath("/leave");
  revalidatePath("/me");
  return { success: "Holiday removed." };
}
