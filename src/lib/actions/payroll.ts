"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { monthlyAttendanceTotals } from "@/lib/attendance";
import { postJournal } from "@/lib/ledger";
import { audit, notify } from "@/lib/audit";
import { isoDate, monthName } from "@/lib/utils";
import type { ActionState } from "@/lib/types";

const runSchema = z.object({
  periodYear: z.coerce.number().int().min(2000).max(2100),
  periodMonth: z.coerce.number().int().min(1).max(12),
});

/**
 * Builds a draft payroll run for one month.
 *
 * Gross = basic + allowances from the employee's salary structure.
 * Overtime = recorded overtime minutes × the hourly rate derived from basic
 * pay and the company's standard month, × the company's overtime multiplier.
 * Everything is computed in one pass from attendance totals, so re-generating
 * a draft after fixing an attendance record produces corrected payslips.
 */
export async function generatePayrollAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("payroll", "create");
  const parsed = runSchema.safeParse({
    periodYear: formData.get("periodYear"),
    periodMonth: formData.get("periodMonth"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const { periodYear, periodMonth } = parsed.data;
  const db = await getDb();
  const settings = await getSettings(user.tenant_id);

  const existing = await db`
    SELECT id, status FROM payroll_runs
     WHERE tenant_id = ${user.tenant_id}
       AND period_year = ${periodYear} AND period_month = ${periodMonth}
  `;
  const prior = existing[0] as { id: string; status: string } | undefined;
  if (prior && prior.status !== "draft") {
    return {
      error: `${monthName(periodMonth)} ${periodYear} is already ${prior.status} and cannot be regenerated.`,
    };
  }

  const employees = await db`
    SELECT u.id, u.full_name,
           COALESCE(p.basic_salary, 0)::float        AS basic,
           COALESCE(p.house_rent, 0)::float          AS house_rent,
           COALESCE(p.medical_allowance, 0)::float   AS medical,
           COALESCE(p.transport_allowance, 0)::float AS transport,
           COALESCE(p.other_allowance, 0)::float     AS other
      FROM users u
      LEFT JOIN employee_profiles p ON p.user_id = u.id
     WHERE u.tenant_id = ${user.tenant_id} AND u.status = 'active'
     ORDER BY u.full_name
  `;
  const staff = employees as unknown as {
    id: string;
    full_name: string;
    basic: number;
    house_rent: number;
    medical: number;
    transport: number;
    other: number;
  }[];
  if (staff.length === 0) return { error: "There are no active employees to pay." };

  const attendance = await monthlyAttendanceTotals(user.tenant_id, periodYear, periodMonth);
  const byUser = new Map(attendance.map((a) => [a.user_id, a]));

  let runId = prior?.id;
  if (runId) {
    await db`DELETE FROM payslips WHERE payroll_run_id = ${runId} AND tenant_id = ${user.tenant_id}`;
  } else {
    const created = await db`
      INSERT INTO payroll_runs (tenant_id, period_year, period_month, status, processed_by)
      VALUES (${user.tenant_id}, ${periodYear}, ${periodMonth}, 'draft', ${user.id})
      RETURNING id
    `;
    runId = (created[0] as { id: string }).id;
  }

  // One standard month of working hours, used to turn a monthly basic salary
  // into the hourly rate overtime is paid at.
  const standardMonthMinutes = settings.standard_work_minutes * 22;

  let gross = 0;
  let net = 0;
  for (const e of staff) {
    const att = byUser.get(e.id);
    const allowances = e.house_rent + e.medical + e.transport + e.other;
    const overtimeMinutes = att?.overtime_minutes ?? 0;
    const hourlyRate = standardMonthMinutes > 0 ? (e.basic / standardMonthMinutes) * 60 : 0;
    const overtimeAmount =
      Math.round(
        (overtimeMinutes / 60) * hourlyRate * settings.overtime_multiplier * 100
      ) / 100;

    const payslipGross = e.basic + allowances + overtimeAmount;
    const payslipNet = payslipGross; // tax and other deductions are entered per payslip

    gross += payslipGross;
    net += payslipNet;

    await db`
      INSERT INTO payslips
        (tenant_id, payroll_run_id, user_id, basic, allowances, overtime_minutes,
         overtime_amount, gross, net_pay, present_days, leave_days, absent_days)
      VALUES (${user.tenant_id}, ${runId}, ${e.id}, ${e.basic}, ${allowances},
              ${overtimeMinutes}, ${overtimeAmount}, ${payslipGross}, ${payslipNet},
              ${att?.present_days ?? 0}, ${att?.leave_days ?? 0}, ${att?.absent_days ?? 0})
    `;
  }

  await db`
    UPDATE payroll_runs
       SET gross_total = ${gross}, deduction_total = 0, net_total = ${net},
           processed_by = ${user.id}, processed_at = now()
     WHERE id = ${runId} AND tenant_id = ${user.tenant_id}
  `;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "payroll.generated",
    entity: "payroll_run",
    entityId: runId,
    summary: `Generated payroll for ${monthName(periodMonth)} ${periodYear} — ${staff.length} payslips`,
  });

  revalidatePath("/payroll");
  return {
    success: `Draft payroll for ${monthName(periodMonth)} ${periodYear} created with ${staff.length} payslips.`,
  };
}

const deductionSchema = z.object({
  payslipId: z.string().uuid(),
  taxDeduction: z.coerce.number().min(0).max(100_000_000).default(0),
  otherDeduction: z.coerce.number().min(0).max(100_000_000).default(0),
  bonus: z.coerce.number().min(0).max(100_000_000).default(0),
});

/** Adjusts one payslip while its run is still a draft. */
export async function updatePayslipAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("payroll", "edit");
  const parsed = deductionSchema.safeParse({
    payslipId: formData.get("payslipId"),
    taxDeduction: formData.get("taxDeduction") || 0,
    otherDeduction: formData.get("otherDeduction") || 0,
    bonus: formData.get("bonus") || 0,
  });
  if (!parsed.success) return { error: "Invalid amounts." };
  const d = parsed.data;
  const db = await getDb();

  const rows = await db`
    SELECT ps.id, ps.payroll_run_id, ps.basic, ps.allowances, ps.overtime_amount, pr.status
      FROM payslips ps
      JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
     WHERE ps.id = ${d.payslipId} AND ps.tenant_id = ${user.tenant_id}
  `;
  const ps = rows[0] as
    | {
        id: string;
        payroll_run_id: string;
        basic: string;
        allowances: string;
        overtime_amount: string;
        status: string;
      }
    | undefined;
  if (!ps) return { error: "Payslip not found." };
  if (ps.status !== "draft") return { error: "This run is no longer a draft." };

  const gross =
    Number(ps.basic) + Number(ps.allowances) + Number(ps.overtime_amount) + d.bonus;
  const netPay = Math.max(0, gross - d.taxDeduction - d.otherDeduction);

  await db`
    UPDATE payslips
       SET bonus = ${d.bonus}, tax_deduction = ${d.taxDeduction},
           other_deduction = ${d.otherDeduction}, gross = ${gross}, net_pay = ${netPay}
     WHERE id = ${d.payslipId} AND tenant_id = ${user.tenant_id}
  `;
  await db`
    UPDATE payroll_runs pr
       SET gross_total = t.gross, deduction_total = t.deductions, net_total = t.net
      FROM (SELECT COALESCE(SUM(gross), 0) AS gross,
                   COALESCE(SUM(tax_deduction + other_deduction), 0) AS deductions,
                   COALESCE(SUM(net_pay), 0) AS net
              FROM payslips
             WHERE payroll_run_id = ${ps.payroll_run_id} AND tenant_id = ${user.tenant_id}) AS t
     WHERE pr.id = ${ps.payroll_run_id} AND pr.tenant_id = ${user.tenant_id}
  `;

  revalidatePath(`/payroll/${ps.payroll_run_id}`);
  return { success: "Payslip updated." };
}

const statusSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(["approved", "paid", "cancelled"]),
});

/**
 * Moves a run through draft → approved → paid. Marking it paid posts the
 * double entry (payroll expense debited, cash credited) so the general ledger
 * reflects salaries without anyone keying a journal by hand.
 */
export async function setPayrollStatusAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("payroll", "approve");
  const parsed = statusSchema.safeParse({
    runId: formData.get("runId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: "Invalid request." };
  const { runId, status } = parsed.data;
  const db = await getDb();

  const rows = await db`
    SELECT id, status, period_year, period_month, net_total::float AS net_total
      FROM payroll_runs WHERE id = ${runId} AND tenant_id = ${user.tenant_id}
  `;
  const run = rows[0] as
    | { id: string; status: string; period_year: number; period_month: number; net_total: number }
    | undefined;
  if (!run) return { error: "Payroll run not found." };

  const allowed: Record<string, string[]> = {
    draft: ["approved", "cancelled"],
    approved: ["paid", "cancelled"],
    paid: [],
    cancelled: [],
  };
  if (!allowed[run.status]?.includes(status)) {
    return { error: `A ${run.status} run cannot be set to ${status}.` };
  }

  await db`
    UPDATE payroll_runs
       SET status = ${status},
           paid_at = ${status === "paid" ? new Date().toISOString() : null}
     WHERE id = ${runId} AND tenant_id = ${user.tenant_id}
  `;
  await db`
    UPDATE payslips SET status = ${status === "paid" ? "paid" : "approved"}
     WHERE payroll_run_id = ${runId} AND tenant_id = ${user.tenant_id}
  `;

  if (status === "paid" && run.net_total > 0) {
    await postJournal(user.tenant_id, {
      date: isoDate(user.tenant.timezone),
      description: `Payroll ${monthName(run.period_month)} ${run.period_year}`,
      source: "payroll",
      sourceId: runId,
      createdBy: user.id,
      lines: [
        { accountKey: "payroll_expense", debit: run.net_total, memo: "Net salaries" },
        { accountKey: "cash", credit: run.net_total, memo: "Salary disbursement" },
      ],
    });

    const recipients = await db`
      SELECT user_id, net_pay::float AS net_pay FROM payslips
       WHERE payroll_run_id = ${runId} AND tenant_id = ${user.tenant_id}
    `;
    for (const r of recipients as { user_id: string; net_pay: number }[]) {
      await notify({
        tenantId: user.tenant_id,
        userId: r.user_id,
        title: "Payslip available",
        body: `Your ${monthName(run.period_month)} ${run.period_year} salary has been processed.`,
        link: "/payroll",
      });
    }
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: `payroll.${status}`,
    entity: "payroll_run",
    entityId: runId,
    summary: `${monthName(run.period_month)} ${run.period_year} payroll set to ${status}`,
  });

  revalidatePath("/payroll");
  revalidatePath(`/payroll/${runId}`);
  return { success: `Payroll ${status}.` };
}
