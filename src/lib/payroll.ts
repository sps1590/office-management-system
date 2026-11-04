import "server-only";
import { getDb } from "./db";

export type PayrollRun = {
  id: string;
  period_year: number;
  period_month: number;
  status: string;
  gross_total: number;
  deduction_total: number;
  net_total: number;
  processed_at: string | null;
  paid_at: string | null;
  processed_by_name: string | null;
  payslip_count: number;
};

export type Payslip = {
  id: string;
  user_id: string;
  full_name: string;
  employee_code: string | null;
  designation: string | null;
  basic: number;
  allowances: number;
  overtime_minutes: number;
  overtime_amount: number;
  bonus: number;
  gross: number;
  tax_deduction: number;
  other_deduction: number;
  net_pay: number;
  present_days: number;
  leave_days: number;
  absent_days: number;
  status: string;
};

export async function listPayrollRuns(tenantId: string): Promise<PayrollRun[]> {
  const db = await getDb();
  const rows = await db`
    SELECT pr.id, pr.period_year, pr.period_month, pr.status,
           pr.gross_total::float AS gross_total,
           pr.deduction_total::float AS deduction_total,
           pr.net_total::float AS net_total,
           pr.processed_at, pr.paid_at,
           u.full_name AS processed_by_name,
           (SELECT COUNT(*)::int FROM payslips ps
             WHERE ps.payroll_run_id = pr.id) AS payslip_count
      FROM payroll_runs pr
      LEFT JOIN users u ON u.id = pr.processed_by
     WHERE pr.tenant_id = ${tenantId}
     ORDER BY pr.period_year DESC, pr.period_month DESC
  `;
  return rows as unknown as PayrollRun[];
}

export async function getPayrollRun(
  tenantId: string,
  runId: string
): Promise<PayrollRun | null> {
  const db = await getDb();
  const rows = await db`
    SELECT pr.id, pr.period_year, pr.period_month, pr.status,
           pr.gross_total::float AS gross_total,
           pr.deduction_total::float AS deduction_total,
           pr.net_total::float AS net_total,
           pr.processed_at, pr.paid_at,
           u.full_name AS processed_by_name,
           (SELECT COUNT(*)::int FROM payslips ps WHERE ps.payroll_run_id = pr.id) AS payslip_count
      FROM payroll_runs pr
      LEFT JOIN users u ON u.id = pr.processed_by
     WHERE pr.tenant_id = ${tenantId} AND pr.id = ${runId}
  `;
  return (rows[0] as PayrollRun | undefined) ?? null;
}

export async function listPayslips(tenantId: string, runId: string): Promise<Payslip[]> {
  const db = await getDb();
  const rows = await db`
    SELECT ps.id, ps.user_id, ps.basic::float AS basic, ps.allowances::float AS allowances,
           ps.overtime_minutes, ps.overtime_amount::float AS overtime_amount,
           ps.bonus::float AS bonus, ps.gross::float AS gross,
           ps.tax_deduction::float AS tax_deduction,
           ps.other_deduction::float AS other_deduction,
           ps.net_pay::float AS net_pay,
           ps.present_days::float AS present_days,
           ps.leave_days::float AS leave_days,
           ps.absent_days::float AS absent_days,
           ps.status,
           u.full_name, u.employee_code, u.designation
      FROM payslips ps
      JOIN users u ON u.id = ps.user_id
     WHERE ps.tenant_id = ${tenantId} AND ps.payroll_run_id = ${runId}
     ORDER BY u.full_name
  `;
  return rows as unknown as Payslip[];
}

/** The signed-in employee's own payslip history. */
export async function myPayslips(tenantId: string, userId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT ps.id, ps.gross::float AS gross, ps.net_pay::float AS net_pay,
           ps.overtime_amount::float AS overtime_amount,
           ps.tax_deduction::float AS tax_deduction,
           ps.other_deduction::float AS other_deduction,
           ps.status,
           pr.period_year, pr.period_month, pr.paid_at
      FROM payslips ps
      JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
     WHERE ps.tenant_id = ${tenantId} AND ps.user_id = ${userId}
       AND pr.status IN ('approved','paid')
     ORDER BY pr.period_year DESC, pr.period_month DESC
     LIMIT 24
  `;
  return rows as unknown as {
    id: string;
    gross: number;
    net_pay: number;
    overtime_amount: number;
    tax_deduction: number;
    other_deduction: number;
    status: string;
    period_year: number;
    period_month: number;
    paid_at: string | null;
  }[];
}
