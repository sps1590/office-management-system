import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ScrollText } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { attendanceSummary, attendanceTrend } from "@/lib/attendance";
import { employeeStats } from "@/lib/employees";
import { fleetCostTrend, fleetStats } from "@/lib/fleet";
import { inventoryStats, procurementStats, spendByVendor } from "@/lib/procurement";
import { crmStats, pipelineByStage } from "@/lib/crm";
import { cashFlowTrend, financeStats } from "@/lib/finance";
import { incomeStatement } from "@/lib/ledger";
import { AreaChart, BarChart, DonutChart, RowBars } from "@/components/charts";
import { Card, KpiCard, PageHeader } from "@/components/ui";
import { compact, isoDate, money, num, percent } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const user = await requirePermission("reports", "view");
  const tz = user.tenant.timezone;
  const currency = user.tenant.currency;
  const year = Number(isoDate(tz).slice(0, 4));

  const [people, attendance, trend, fleet, fleetCost, inventory, procurement, vendorSpend, crm, funnel, finance, cash, pnl] =
    await Promise.all([
      employeeStats(user.tenant_id),
      attendanceSummary(user.tenant_id, isoDate(tz)),
      attendanceTrend(user.tenant_id, tz, 30),
      fleetStats(user.tenant_id, tz),
      fleetCostTrend(user.tenant_id, tz),
      inventoryStats(user.tenant_id),
      procurementStats(user.tenant_id, tz),
      spendByVendor(user.tenant_id, tz, 6),
      crmStats(user.tenant_id, tz),
      pipelineByStage(user.tenant_id),
      financeStats(user.tenant_id, tz),
      cashFlowTrend(user.tenant_id, tz, 6),
      incomeStatement(user.tenant_id, `${year}-01-01`, isoDate(tz)),
    ]);

  const can = (m: Parameters<typeof hasPermission>[1]) => hasPermission(user, m, "view");

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Cross-module summary for ${user.tenant.company_name}. Every figure is computed in SQL from live data — nothing here is cached.`}
      >
        {can("mis") && (
          <Link href="/mis" className="btn btn-secondary">
            Executive MIS
            <ArrowRight size={15} />
          </Link>
        )}
      </PageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Headcount" value={people.totals.active} sub={`${people.totals.total} records`} />
        <KpiCard
          label="Attendance today"
          value={`${percent(attendance.present, attendance.headcount || 1)}%`}
          sub={`${attendance.present} of ${attendance.headcount} present`}
          tone={attendance.present / (attendance.headcount || 1) >= 0.8 ? "success" : "warning"}
        />
        <KpiCard
          label={`Revenue, ${year}`}
          value={`${currency} ${compact(pnl.income)}`}
          tone="success"
        />
        <KpiCard
          label={`Profit, ${year}`}
          value={`${currency} ${compact(pnl.profit)}`}
          tone={pnl.profit >= 0 ? "success" : "danger"}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2 mt-4 items-start">
        {can("attendance") && (
          <Card title="Attendance, last 30 days">
            <AreaChart data={trend} height={190} />
          </Card>
        )}

        {can("invoicing") && (
          <Card title={`Cash movement, last 6 months (${currency})`}>
            <BarChart
              data={cash.map((c) => ({ label: c.label, value: c.inflow - c.outflow }))}
              height={190}
              format={(n) => compact(n)}
              colors={cash.map((c) =>
                c.inflow - c.outflow >= 0 ? "var(--series-4)" : "var(--series-5)"
              )}
            />
          </Card>
        )}

        {can("employees") && (
          <Card title="Headcount by department">
            <RowBars data={people.byDepartment} />
          </Card>
        )}

        {can("crm") && (
          <Card title={`Open pipeline by stage (${currency})`}>
            <RowBars
              data={funnel.map((f) => ({ label: f.label, value: f.value }))}
              colors={funnel.map((f) => f.color)}
              format={(n) => money(n, currency)}
            />
          </Card>
        )}

        {can("vendors") && (
          <Card title={`Vendor spend this year (${currency})`}>
            <RowBars data={vendorSpend} format={(n) => money(n, currency)} />
          </Card>
        )}

        {can("fleet") && (
          <Card title="Fleet status">
            <DonutChart
              data={[
                { label: "Available", value: fleet.available },
                { label: "In use", value: fleet.in_use },
                { label: "Maintenance", value: fleet.maintenance },
              ]}
              centerValue={String(fleet.total)}
              centerLabel="vehicles"
            />
            <p className="help mt-3">
              Running cost, last 6 months:{" "}
              {money(
                fleetCost.reduce((s, c) => s + c.trips + c.maintenance, 0),
                currency
              )}
              . Total distance on the clocks: {num(fleet.total_odometer)} km.
            </p>
          </Card>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mt-4">
        {can("inventory") && (
          <>
            <KpiCard
              label="Stock value"
              value={`${currency} ${compact(inventory.stock_value)}`}
              sub={`${inventory.items} active items`}
            />
            <KpiCard
              label="Needs reorder"
              value={inventory.low_stock}
              sub={`${inventory.out_of_stock} out of stock`}
              tone={inventory.low_stock > 0 ? "warning" : "success"}
            />
          </>
        )}
        {can("procurement") && (
          <>
            <KpiCard
              label="PO committed this year"
              value={`${currency} ${compact(procurement.committed_ytd)}`}
              sub={`${procurement.received} received`}
            />
            <KpiCard
              label="PO pending approval"
              value={procurement.pending}
              sub={money(procurement.pending_value, currency)}
              tone={procurement.pending > 0 ? "warning" : "default"}
            />
          </>
        )}
        {can("invoicing") && (
          <>
            <KpiCard
              label="Receivable outstanding"
              value={money(finance.receivable.outstanding, currency)}
              sub={`${finance.receivable.overdue > 0 ? money(finance.receivable.overdue, currency) + " overdue" : "nothing overdue"}`}
              tone={finance.receivable.overdue > 0 ? "danger" : "success"}
            />
            <KpiCard
              label="Payable outstanding"
              value={money(finance.payable.outstanding, currency)}
              tone={finance.payable.overdue > 0 ? "warning" : "default"}
            />
          </>
        )}
        {can("crm") && (
          <>
            <KpiCard
              label="Won this year"
              value={`${currency} ${compact(crm.won_year)}`}
              sub={`${crm.won_count} deals`}
              tone="success"
            />
            <KpiCard
              label="Win rate"
              value={`${percent(crm.won_count, crm.won_count + crm.lost_count)}%`}
              sub={`${crm.open_deals} still open`}
            />
          </>
        )}
      </div>

      <Card title={`Profit and loss, ${year}`} className="mt-4" bodyClassName="p-0">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th>Type</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {pnl.lines.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-fg-subtle">
                    Nothing posted to income or expense accounts yet this year.
                  </td>
                </tr>
              ) : (
                pnl.lines.map((l) => (
                  <tr key={l.code}>
                    <td className="tnum text-fg-muted">{l.code}</td>
                    <td className="font-medium">{l.name}</td>
                    <td className="text-fg-muted capitalize">{l.type}</td>
                    <td className="right">
                      {money(l.type === "income" ? l.net : -l.net, currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={3}>Net profit</td>
                <td className="right">{money(pnl.profit, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <p className="mt-4 text-xs text-fg-subtle flex items-center gap-1.5">
        <ScrollText size={13} />
        Sections you cannot see are hidden by your role&apos;s permissions, not missing
        from the system.
      </p>
    </>
  );
}
