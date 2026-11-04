import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, CircleSlash, Send } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { getPayrollRun, listPayslips } from "@/lib/payroll";
import { setPayrollStatusAction, updatePayslipAction } from "@/lib/actions/payroll";
import ActionButton from "@/components/ActionButton";
import AutoForm from "@/components/forms/AutoForm";
import { Avatar, Card, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { duration, money, monthName, num } from "@/lib/utils";

export const metadata: Metadata = { title: "Payroll run" };

export default async function PayrollRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("payroll", "view");
  const { id } = await params;

  const run = await getPayrollRun(user.tenant_id, id);
  if (!run) notFound();
  const payslips = await listPayslips(user.tenant_id, id);

  const currency = user.tenant.currency;
  const canApprove = hasPermission(user, "payroll", "approve");
  const canEdit = hasPermission(user, "payroll", "edit") && run.status === "draft";
  const totalOvertime = payslips.reduce((s, p) => s + p.overtime_minutes, 0);

  return (
    <>
      <Link href="/payroll" className="btn btn-ghost btn-sm mb-4">
        <ArrowLeft size={15} />
        Payroll
      </Link>

      <PageHeader
        title={`${monthName(run.period_month)} ${run.period_year}`}
        description={`${run.payslip_count} payslips · prepared by ${run.processed_by_name ?? "—"}`}
      >
        <StatusBadge status={run.status} />
        {canApprove && run.status === "draft" && (
          <ActionButton
            action={setPayrollStatusAction}
            values={{ runId: run.id, status: "approved" }}
            label="Approve run"
            className="btn-primary"
            icon={<Check size={15} />}
            confirm="Approve this payroll run? Payslips become visible to employees and the run can no longer be regenerated."
          />
        )}
        {canApprove && run.status === "approved" && (
          <ActionButton
            action={setPayrollStatusAction}
            values={{ runId: run.id, status: "paid" }}
            label="Mark as paid"
            className="btn-primary"
            icon={<Send size={15} />}
            confirm="Mark this run as paid? This posts salaries to the general ledger."
          />
        )}
        {canApprove && (run.status === "draft" || run.status === "approved") && (
          <ActionButton
            action={setPayrollStatusAction}
            values={{ runId: run.id, status: "cancelled" }}
            label="Cancel"
            className="btn-secondary"
            icon={<CircleSlash size={15} />}
            confirm="Cancel this payroll run?"
          />
        )}
      </PageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Gross" value={money(run.gross_total, currency)} />
        <KpiCard label="Deductions" value={money(run.deduction_total, currency)} />
        <KpiCard label="Net payable" value={money(run.net_total, currency)} tone="success" />
        <KpiCard label="Overtime in period" value={duration(totalOvertime)} />
      </section>

      <Card title="Payslips" className="mt-4" bodyClassName="p-0">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="right">Days</th>
                <th className="right">Basic</th>
                <th className="right">Allowances</th>
                <th className="right">Overtime</th>
                <th className="right">Bonus</th>
                <th className="right">Deductions</th>
                <th className="right">Net pay</th>
              </tr>
            </thead>
            <tbody>
              {payslips.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={p.full_name} size={26} />
                      <span className="min-w-0">
                        <span className="block font-medium truncate">{p.full_name}</span>
                        <span className="block text-xs text-fg-subtle truncate">
                          {p.designation ?? p.employee_code ?? "—"}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="right text-fg-muted">
                    {num(p.present_days, 0)}P / {num(p.leave_days, 0)}L / {num(p.absent_days, 0)}A
                  </td>
                  <td className="right">{money(p.basic, currency)}</td>
                  <td className="right">{money(p.allowances, currency)}</td>
                  <td className="right">
                    {p.overtime_amount > 0 ? (
                      <span title={duration(p.overtime_minutes)}>
                        {money(p.overtime_amount, currency)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="right">{p.bonus > 0 ? money(p.bonus, currency) : "—"}</td>
                  <td className="right">
                    {money(p.tax_deduction + p.other_deduction, currency)}
                  </td>
                  <td className="right font-semibold">{money(p.net_pay, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {canEdit && (
        <Card title="Adjust a payslip" className="mt-4">
          <p className="text-sm text-fg-muted mb-4">
            Bonus, tax and other deductions are entered per payslip while the run is a
            draft. The net figure and the run totals recalculate on save.
          </p>
          <AutoForm
            action={updatePayslipAction}
            columns={3}
            submitLabel="Apply adjustment"
            fields={[
              {
                name: "payslipId",
                label: "Employee",
                type: "select",
                required: true,
                span: 3,
                options: payslips.map((p) => ({
                  value: p.id,
                  label: `${p.full_name} — net ${money(p.net_pay, currency)}`,
                })),
              },
              { name: "bonus", label: `Bonus (${currency})`, type: "number", min: 0, step: "0.01", defaultValue: 0 },
              { name: "taxDeduction", label: `Tax (${currency})`, type: "number", min: 0, step: "0.01", defaultValue: 0 },
              { name: "otherDeduction", label: `Other deduction (${currency})`, type: "number", min: 0, step: "0.01", defaultValue: 0 },
            ]}
          />
        </Card>
      )}
    </>
  );
}
