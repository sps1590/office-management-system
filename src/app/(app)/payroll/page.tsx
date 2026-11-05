import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, Calculator, Wallet } from "lucide-react";
import { canSeeEveryone, hasPermission, requirePermission } from "@/lib/permissions";
import { listPayrollRuns, myPayslips } from "@/lib/payroll";
import { generatePayrollAction } from "@/lib/actions/payroll";
import AutoForm from "@/components/forms/AutoForm";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, isoDate, money, monthName } from "@/lib/utils";

export const metadata: Metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const user = await requirePermission("payroll", "view");
  const seesAll = canSeeEveryone(user, "payroll");
  const currency = user.tenant.currency;
  const tz = user.tenant.timezone;

  const [runs, mine] = await Promise.all([
    seesAll ? listPayrollRuns(user.tenant_id) : [],
    myPayslips(user.tenant_id, user.id),
  ]);

  // Which month "last month" is depends on the company's calendar, not the
  // server's: on the first of the month they can disagree.
  const [thisYear, thisMonth] = isoDate(tz).split("-").map(Number);
  const lastMonth = new Date(Date.UTC(thisYear, thisMonth - 2, 1));
  const paidRuns = runs.filter((r) => r.status === "paid");
  const latestPaid = paidRuns[0];

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Generates a draft from each employee's salary structure and their recorded attendance, including overtime at the company multiplier."
      />

      {seesAll && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Runs recorded"
            value={runs.length}
            icon={<Calculator size={16} />}
          />
          <KpiCard
            label="Last paid period"
            value={
              latestPaid
                ? `${monthName(latestPaid.period_month).slice(0, 3)} ${latestPaid.period_year}`
                : "—"
            }
            sub={latestPaid ? money(latestPaid.net_total, currency) : "Nothing paid yet"}
            icon={<Banknote size={16} />}
            tone={latestPaid ? "success" : "default"}
          />
          <KpiCard
            label="Drafts awaiting approval"
            value={runs.filter((r) => r.status === "draft").length}
            tone={runs.some((r) => r.status === "draft") ? "warning" : "default"}
          />
          <KpiCard
            label="Approved, not yet paid"
            value={runs.filter((r) => r.status === "approved").length}
            tone={runs.some((r) => r.status === "approved") ? "info" : "default"}
          />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          {seesAll && (
            <Card title="Payroll runs" bodyClassName="p-0">
              {runs.length === 0 ? (
                <EmptyState
                  icon={<Calculator size={20} />}
                  title="No payroll runs yet"
                  description="Generate a draft for a month to get started. Drafts can be regenerated until approved."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th className="right">Payslips</th>
                        <th className="right">Gross</th>
                        <th className="right">Deductions</th>
                        <th className="right">Net</th>
                        <th>Status</th>
                        <th>Processed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <Link
                              href={`/payroll/${r.id}`}
                              className="font-medium hover:text-primary transition-colors"
                            >
                              {monthName(r.period_month)} {r.period_year}
                            </Link>
                          </td>
                          <td className="right">{r.payslip_count}</td>
                          <td className="right">{money(r.gross_total, currency)}</td>
                          <td className="right">{money(r.deduction_total, currency)}</td>
                          <td className="right font-semibold">
                            {money(r.net_total, currency)}
                          </td>
                          <td>
                            <StatusBadge status={r.status} />
                          </td>
                          <td className="text-fg-muted">
                            {r.paid_at
                              ? `Paid ${formatDate(r.paid_at, tz)}`
                              : r.processed_at
                                ? formatDate(r.processed_at, tz)
                                : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          <Card title="My payslips" bodyClassName="p-0">
            {mine.length === 0 ? (
              <EmptyState
                icon={<Wallet size={20} />}
                title="No payslips yet"
                description="Your payslips appear here once a payroll run is approved."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th className="right">Gross</th>
                      <th className="right">Overtime</th>
                      <th className="right">Deductions</th>
                      <th className="right">Net pay</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((p) => (
                      <tr key={p.id}>
                        <td className="font-medium">
                          {monthName(p.period_month)} {p.period_year}
                        </td>
                        <td className="right">{money(p.gross, currency)}</td>
                        <td className="right">
                          {p.overtime_amount > 0 ? money(p.overtime_amount, currency) : "—"}
                        </td>
                        <td className="right">
                          {money(p.tax_deduction + p.other_deduction, currency)}
                        </td>
                        <td className="right font-semibold">{money(p.net_pay, currency)}</td>
                        <td>
                          <StatusBadge status={p.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {hasPermission(user, "payroll", "create") && (
          <Card title="Generate a run">
            <p className="text-sm text-fg-muted mb-4">
              Creates a draft payslip for every active employee. Re-running a month
              rebuilds its draft, so you can fix attendance and generate again.
            </p>
            <AutoForm
              action={generatePayrollAction}
              columns={1}
              submitLabel="Generate draft"
              pendingLabel="Calculating…"
              fields={[
                {
                  name: "periodMonth",
                  label: "Month",
                  type: "select",
                  required: true,
                  defaultValue: String(lastMonth.getUTCMonth() + 1),
                  options: Array.from({ length: 12 }, (_, i) => ({
                    value: String(i + 1),
                    label: monthName(i + 1),
                  })),
                },
                {
                  name: "periodYear",
                  label: "Year",
                  type: "number",
                  required: true,
                  min: 2000,
                  max: 2100,
                  defaultValue: lastMonth.getUTCFullYear(),
                },
              ]}
            />
          </Card>
        )}
      </div>
    </>
  );
}
