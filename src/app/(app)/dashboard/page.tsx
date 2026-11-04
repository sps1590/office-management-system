import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Handshake,
  Radio,
  Truck,
  Users,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { loadDashboard } from "@/lib/dashboard";
import { todaysAttendance } from "@/lib/attendance";
import { getSettings } from "@/lib/settings";
import { AreaChart, BarChart } from "@/components/charts";
import CheckInWidget from "@/components/CheckInWidget";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { compact, formatDate, money, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const [data, today, settings] = await Promise.all([
    loadDashboard(user.tenant_id, user.id),
    todaysAttendance(user.tenant_id, user.id),
    getSettings(user.tenant_id),
  ]);

  const can = (m: Parameters<typeof hasPermission>[1]) => hasPermission(user, m, "view");
  const currency = user.tenant.currency;
  const firstName = user.full_name.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description={`${user.tenant.company_name} · ${new Date().toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}`}
      >
        {can("mis") && (
          <Link href="/mis" className="btn btn-secondary">
            Executive MIS
            <ArrowRight size={15} />
          </Link>
        )}
      </PageHeader>

      {/* Personal row: attendance plus whatever is waiting on this person. */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CheckInWidget
          checkedInAt={today?.check_in_at ?? null}
          checkedOutAt={today?.check_out_at ?? null}
          workedMinutes={today?.worked_minutes ?? 0}
          requiresLocation={settings.require_geofenced_checkin}
        />

        <KpiCard
          label="Waiting on your approval"
          value={data.myApprovals}
          sub={
            data.myApprovals === 0
              ? "Nothing in your queue"
              : `${data.myApprovalBreakdown.leave_count} leave · ${data.myApprovalBreakdown.po_count} purchase orders`
          }
          icon={<ClipboardCheck size={16} />}
          tone={data.myApprovals > 0 ? "warning" : "success"}
          href={data.myApprovalBreakdown.po_count > 0 ? "/procurement" : "/leave"}
        />

        <KpiCard
          label="My open tasks"
          value={data.myTasks.length}
          sub={
            data.myTasks[0]?.due_date
              ? `Next due ${formatDate(data.myTasks[0].due_date)}`
              : "No deadlines set"
          }
          icon={<CheckCircle2 size={16} />}
          href="/tasks"
        />

        {can("tracking") ? (
          <KpiCard
            label="Field staff live now"
            value={data.fieldActive}
            sub="Reported in the last 15 minutes"
            icon={<Radio size={16} />}
            tone={data.fieldActive > 0 ? "success" : "default"}
            href="/tracking/map"
          />
        ) : (
          <KpiCard
            label="Leave balance"
            value="—"
            sub="See your entitlement and history"
            icon={<CalendarDays size={16} />}
            href="/leave"
          />
        )}
      </section>

      {/* Company row: only for roles that can see company-wide numbers. */}
      {(can("employees") || can("fleet") || can("inventory") || can("crm")) && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mt-4">
          {can("attendance") && (
            <KpiCard
              label="Present today"
              value={`${data.attendance.present}/${data.attendance.headcount}`}
              sub={`${data.attendance.late} late · ${data.attendance.on_leave} on leave · ${data.attendance.absent} absent`}
              icon={<Users size={16} />}
              tone={
                data.attendance.headcount > 0 &&
                data.attendance.present / data.attendance.headcount < 0.8
                  ? "warning"
                  : "success"
              }
              href="/attendance"
            />
          )}
          {can("fleet") && (
            <KpiCard
              label="Fleet in use"
              value={`${data.fleet.in_use}/${data.fleet.total}`}
              sub={`${data.fleet.available} available · ${data.fleet.maintenance} in maintenance`}
              icon={<Truck size={16} />}
              href="/fleet"
            />
          )}
          {can("inventory") && (
            <KpiCard
              label="Stock value"
              value={`${currency} ${compact(data.inventory.stock_value)}`}
              sub={
                data.inventory.low_stock > 0
                  ? `${data.inventory.low_stock} item(s) at or below reorder level`
                  : `${data.inventory.items} items, all above reorder level`
              }
              icon={<Boxes size={16} />}
              tone={data.inventory.low_stock > 0 ? "warning" : "default"}
              href="/inventory"
            />
          )}
          {can("crm") && (
            <KpiCard
              label="Open pipeline"
              value={`${currency} ${compact(data.pipeline.open_value)}`}
              sub={`${data.pipeline.open_deals} open deals · ${currency} ${compact(
                data.pipeline.won_this_month
              )} won this month`}
              icon={<Handshake size={16} />}
              href="/deals"
            />
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3 mt-4">
        {can("attendance") && (
          <Card
            title="Attendance, last 14 days"
            className="lg:col-span-2"
            action={
              <Link href="/attendance" className="btn btn-ghost btn-sm">
                View all
              </Link>
            }
          >
            <AreaChart data={data.trend} height={200} />
          </Card>
        )}

        <Card title="My tasks" bodyClassName="p-0">
          {data.myTasks.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={20} />}
              title="Nothing assigned"
              description="Tasks assigned to you will appear here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.myTasks.map((t) => (
                <li key={t.id} className="px-5 py-3 hover:bg-surface-hover transition-colors">
                  <Link href="/tasks" className="block">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium leading-snug">{t.title}</p>
                      <StatusBadge status={t.priority} />
                    </div>
                    <p className="mt-1 text-xs text-fg-subtle">
                      {t.due_date ? `Due ${formatDate(t.due_date)}` : "No due date"} ·{" "}
                      {t.status.replace(/_/g, " ")}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {can("invoicing") && (
        <div className="grid gap-4 lg:grid-cols-3 mt-4">
          <Card title="Cash in and out, last 6 months" className="lg:col-span-2">
            <BarChart
              data={data.monthlyCash.map((m) => ({
                label: m.label,
                value: m.inflow - m.outflow,
              }))}
              height={200}
              format={(n) => compact(n)}
              colors={data.monthlyCash.map((m) =>
                m.inflow - m.outflow >= 0 ? "var(--series-4)" : "var(--series-5)"
              )}
            />
            <p className="help mt-2">
              Net movement per month from recorded payments. Positive bars are months
              where receipts exceeded disbursements.
            </p>
          </Card>

          <div className="grid gap-4 content-start">
            <KpiCard
              label="Receivable outstanding"
              value={money(data.receivables.outstanding, currency)}
              sub={
                data.receivables.overdue > 0
                  ? `${data.receivables.overdue} invoice(s) overdue`
                  : "Nothing overdue"
              }
              icon={<FileText size={16} />}
              tone={data.receivables.overdue > 0 ? "danger" : "success"}
              href="/invoices"
            />
            <KpiCard
              label="Payable outstanding"
              value={money(data.payables.outstanding, currency)}
              sub={
                data.payables.overdue > 0
                  ? `${data.payables.overdue} bill(s) overdue`
                  : "Nothing overdue"
              }
              icon={<Banknote size={16} />}
              tone={data.payables.overdue > 0 ? "warning" : "default"}
              href="/bills"
            />
          </div>
        </div>
      )}

      {/* Things that need someone's attention, company-wide. */}
      {(can("leave") || can("procurement") || can("expenses") || can("fleet")) && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mt-4">
          {can("leave") && data.leavePending > 0 && (
            <KpiCard
              label="Leave requests pending"
              value={data.leavePending}
              sub="Awaiting a decision somewhere in the chain"
              icon={<CalendarDays size={16} />}
              tone="warning"
              href="/leave"
            />
          )}
          {can("procurement") && data.poPending.c > 0 && (
            <KpiCard
              label="Purchase orders pending"
              value={data.poPending.c}
              sub={`${money(data.poPending.amount, currency)} awaiting approval`}
              icon={<FileText size={16} />}
              tone="warning"
              href="/procurement"
            />
          )}
          {can("expenses") && data.expenses.pending > 0 && (
            <KpiCard
              label="Expense claims pending"
              value={data.expenses.pending}
              sub={`${money(data.expenses.pending_amount, currency)} to verify`}
              icon={<Banknote size={16} />}
              tone="warning"
              href="/expenses"
            />
          )}
          {can("fleet") && data.fleet.docs_expiring > 0 && (
            <KpiCard
              label="Vehicle documents expiring"
              value={data.fleet.docs_expiring}
              sub="Insurance due within 30 days"
              icon={<AlertTriangle size={16} />}
              tone="danger"
              href="/fleet"
            />
          )}
        </section>
      )}

      {can("audit") && data.activity.length > 0 && (
        <Card
          title="Recent activity"
          className="mt-4"
          bodyClassName="p-0"
          action={
            <Link href="/audit" className="btn btn-ghost btn-sm">
              Full audit log
            </Link>
          }
        >
          <ul className="divide-y divide-border">
            {data.activity.map((a) => (
              <li key={a.id} className="px-5 py-3 flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm truncate">{a.summary ?? a.action}</p>
                  <p className="text-xs text-fg-subtle">{a.full_name ?? "System"}</p>
                </div>
                <span className="text-xs text-fg-subtle shrink-0">
                  {relativeTime(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
