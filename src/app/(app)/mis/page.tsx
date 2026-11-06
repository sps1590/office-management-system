import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Boxes,
  MapPin,
  Radio,
  TrendingUp,
  Truck,
  Users,
} from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { attendanceSummary, attendanceTrend } from "@/lib/attendance";
import { employeeStats } from "@/lib/employees";
import { fleetStats } from "@/lib/fleet";
import { inventoryStats, procurementStats } from "@/lib/procurement";
import { crmStats, pipelineByStage, visitStats } from "@/lib/crm";
import { financeStats, cashFlowTrend } from "@/lib/finance";
import { incomeStatement } from "@/lib/ledger";
import {
  listGeofenceEvents,
  livePositions,
  mapSites,
  trackingStats,
} from "@/lib/tracking";
import { taskStats } from "@/lib/workplace";
import OperationsMap from "@/components/OperationsMap";
import { AreaChart, DonutChart, RowBars } from "@/components/charts";
import { Card, KpiCard, PageHeader } from "@/components/ui";
import { compact, isoDate, money, num, percent, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Executive MIS" };

/**
 * SRS 3.1 — the global executive dashboard: HR attendance, daily sales,
 * procurement bottlenecks and fleet utilisation on one screen, with the live
 * operations map beneath it.
 */
export default async function MisPage() {
  const user = await requirePermission("mis", "view");
  const tz = user.tenant.timezone;
  const currency = user.tenant.currency;
  const year = Number(isoDate(tz).slice(0, 4));

  const [
    people,
    attendance,
    trend,
    fleet,
    inventory,
    procurement,
    crm,
    funnel,
    visits,
    finance,
    cash,
    pnl,
    tracking,
    positions,
    sites,
    events,
    tasks,
  ] = await Promise.all([
    employeeStats(user.tenant_id),
    attendanceSummary(user.tenant_id, isoDate(tz)),
    attendanceTrend(user.tenant_id, tz, 21),
    fleetStats(user.tenant_id, tz),
    inventoryStats(user.tenant_id),
    procurementStats(user.tenant_id, tz),
    crmStats(user.tenant_id, tz),
    pipelineByStage(user.tenant_id),
    visitStats(user.tenant_id, tz),
    financeStats(user.tenant_id, tz),
    cashFlowTrend(user.tenant_id, tz, 6),
    incomeStatement(user.tenant_id, `${year}-01-01`, isoDate(tz)),
    trackingStats(user.tenant_id, tz),
    livePositions(user.tenant_id),
    mapSites(user.tenant_id),
    listGeofenceEvents(user.tenant_id, 8),
    taskStats(user.tenant_id, user.id, tz),
  ]);

  const attendanceRate = percent(attendance.present, attendance.headcount || 1);
  // Bottlenecks are what a management dashboard is actually for: the handful of
  // things blocking work right now, in one list.
  const bottlenecks = [
    {
      label: "Purchase orders awaiting approval",
      value: procurement.pending,
      detail: money(procurement.pending_value, currency),
      href: "/procurement",
      bad: procurement.pending > 0,
    },
    {
      label: "Expense claims to verify",
      value: finance.expenses.pending,
      detail: money(finance.expenses.pending_amount, currency),
      href: "/expenses",
      bad: finance.expenses.pending > 0,
    },
    {
      label: "Invoices overdue",
      value: finance.receivable.overdue > 0 ? 1 : 0,
      detail: money(finance.receivable.overdue, currency),
      href: "/invoices",
      bad: finance.receivable.overdue > 0,
    },
    {
      label: "Stock items below reorder level",
      value: inventory.low_stock,
      detail: `${inventory.out_of_stock} out of stock`,
      href: "/inventory",
      bad: inventory.low_stock > 0,
    },
    {
      label: "Vehicle documents expiring",
      value: fleet.insurance_due + fleet.fitness_due,
      detail: "within 30 days",
      href: "/fleet",
      bad: fleet.insurance_due + fleet.fitness_due > 0,
    },
    {
      label: "Route deviations today",
      value: tracking.deviations_today,
      detail: "GPS geofence alerts",
      href: "/tracking",
      bad: tracking.deviations_today > 0,
    },
    {
      label: "Tasks overdue",
      value: tasks.overdue,
      detail: `${tasks.open} open`,
      href: "/tasks",
      bad: tasks.overdue > 0,
    },
  ];

  return (
    <>
      <PageHeader
        title="Executive MIS"
        description={`${user.tenant.company_name} — company-wide operational health, refreshed on every load.`}
      >
        {hasPermission(user, "tracking", "view") && (
          <Link href="/tracking/map" className="btn btn-secondary">
            <MapPin size={15} />
            Full map
          </Link>
        )}
        {hasPermission(user, "reports", "view") && (
          <Link href="/reports" className="btn btn-secondary">
            Reports
          </Link>
        )}
      </PageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Attendance today"
          value={`${attendanceRate}%`}
          sub={`${attendance.present} of ${attendance.headcount} · ${attendance.late} late · ${attendance.absent} absent`}
          icon={<Users size={16} />}
          tone={attendanceRate >= 85 ? "success" : attendanceRate >= 70 ? "warning" : "danger"}
          href="/attendance"
        />
        <KpiCard
          label="Won this month"
          value={`${currency} ${compact(crm.won_month)}`}
          sub={`${crm.open_deals} open · ${currency} ${compact(crm.open_value)} pipeline`}
          icon={<TrendingUp size={16} />}
          tone="success"
          href="/deals"
        />
        <KpiCard
          label="Fleet utilisation"
          value={`${percent(fleet.in_use, fleet.total || 1)}%`}
          sub={`${fleet.in_use} of ${fleet.total} on the road · ${fleet.maintenance} in workshop`}
          icon={<Truck size={16} />}
          href="/fleet"
        />
        <KpiCard
          label="Field staff live"
          value={tracking.live_now}
          sub={`${tracking.active_today} active today · ${num(tracking.points_today)} points`}
          icon={<Radio size={16} />}
          tone={tracking.live_now > 0 ? "success" : "default"}
          href="/tracking/map"
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mt-4">
        <KpiCard
          label={`Revenue, ${year}`}
          value={`${currency} ${compact(pnl.income)}`}
          sub={`profit ${currency} ${compact(pnl.profit)}`}
          tone={pnl.profit >= 0 ? "success" : "danger"}
          href="/finance"
        />
        <KpiCard
          label="Receivable outstanding"
          value={`${currency} ${compact(finance.receivable.outstanding)}`}
          sub={`${currency} ${compact(finance.receivable.overdue)} overdue`}
          tone={finance.receivable.overdue > 0 ? "danger" : "default"}
          href="/invoices"
        />
        <KpiCard
          label="Stock value"
          value={`${currency} ${compact(inventory.stock_value)}`}
          sub={`${inventory.low_stock} need reorder`}
          icon={<Boxes size={16} />}
          tone={inventory.low_stock > 0 ? "warning" : "default"}
          href="/inventory"
        />
        <KpiCard
          label="Field visits verified"
          value={`${visits.verified_month}/${visits.completed_month}`}
          sub="this month, by GPS"
          icon={<Activity size={16} />}
          tone={
            visits.completed_month > 0 && visits.verified_month < visits.completed_month
              ? "warning"
              : "success"
          }
          href="/field-visits"
        />
      </section>

      <Card title="Live operations map" className="mt-4" bodyClassName="p-4">
        <OperationsMap
          people={positions}
          sites={[
            ...sites.warehouses.map((w) => ({ ...w, kind: "warehouse" as const })),
            ...sites.clients.map((c) => ({ ...c, kind: "client" as const })),
          ]}
          height={400}
          refreshSeconds={90}
        />
        <p className="help mt-3">
          {positions.length === 0
            ? "Nothing has reported in the last two hours. Open the tracker on a phone, or enrol a mobile device."
            : `${positions.length} people reporting. Markers with a green dot reported within the last 15 minutes.`}
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3 mt-4 items-start">
        <Card title="Operational bottlenecks" className="lg:col-span-1" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {bottlenecks.map((b) => (
              <li key={b.label}>
                <Link
                  href={b.href}
                  className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-surface-hover transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-sm">{b.label}</span>
                    <span className="block text-xs text-fg-subtle">{b.detail}</span>
                  </span>
                  <span
                    className={
                      b.bad ? "badge badge-warning shrink-0" : "badge badge-success shrink-0"
                    }
                  >
                    {b.bad ? (
                      <>
                        <AlertTriangle size={11} />
                        {b.value}
                      </>
                    ) : (
                      "clear"
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Attendance, last 21 days" className="lg:col-span-2">
          <AreaChart data={trend} height={200} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mt-4 items-start">
        <Card title="Headcount by department">
          <RowBars data={people.byDepartment} />
        </Card>

        <Card title={`Pipeline by stage (${currency})`}>
          <RowBars
            data={funnel.map((f) => ({ label: f.label, value: f.value }))}
            colors={funnel.map((f) => f.color)}
            format={(n) => compact(n)}
          />
        </Card>

        <Card title="Fleet status">
          <DonutChart
            data={[
              { label: "Available", value: fleet.available },
              { label: "In use", value: fleet.in_use },
              { label: "Maintenance", value: fleet.maintenance },
            ]}
            size={150}
            centerValue={String(fleet.total)}
            centerLabel="vehicles"
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mt-4 items-start">
        <Card title={`Cash movement, last 6 months (${currency})`}>
          <AreaChart
            data={cash.map((c) => ({ label: c.label, value: c.inflow - c.outflow }))}
            height={190}
            format={(n) => compact(n)}
          />
        </Card>

        <Card title="Latest geofence activity" bodyClassName="p-0">
          {events.length === 0 ? (
            <p className="px-5 py-5 text-sm text-fg-subtle">
              No geofence events yet. Create a fence and assign it to your field staff.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <li key={e.id} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span
                        className={
                          e.event_type === "deviation"
                            ? "badge badge-danger mr-2"
                            : e.event_type === "enter"
                              ? "badge badge-success mr-2"
                              : "badge badge-warning mr-2"
                        }
                      >
                        {e.event_type}
                      </span>
                      {e.full_name}
                    </p>
                    <p className="text-xs text-fg-subtle">{e.geofence_name ?? "—"}</p>
                  </div>
                  <span className="text-xs text-fg-subtle shrink-0">
                    {relativeTime(e.occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
