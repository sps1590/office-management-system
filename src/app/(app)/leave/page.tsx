import type { Metadata } from "next";
import { CalendarDays, Check, CircleSlash, Plus, X } from "lucide-react";
import { canSeeEveryone, hasPermission, requirePermission } from "@/lib/permissions";
import {
  leaveBalances,
  leaveStats,
  listLeaveRequests,
  listLeaveTypes,
} from "@/lib/leave";
import { getSettings } from "@/lib/settings";
import {
  cancelLeaveAction,
  createLeaveTypeAction,
  decideLeaveAction,
  requestLeaveAction,
} from "@/lib/actions/leave";
import ActionButton from "@/components/ActionButton";
import AutoForm from "@/components/forms/AutoForm";
import FilterBar from "@/components/FilterBar";
import { Avatar, Card, EmptyState, KpiCard, PageHeader, Progress, StatusBadge } from "@/components/ui";
import { formatDate, isoDate, num, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Leave" };

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requirePermission("leave", "view");
  const sp = await searchParams;
  const year = new Date().getFullYear();

  const seesTeam = canSeeEveryone(user, "leave");

  const [types, balances, settings, stats, mine, queue, all] = await Promise.all([
    listLeaveTypes(user.tenant_id),
    leaveBalances(user.tenant_id, user.id, year),
    getSettings(user.tenant_id),
    seesTeam ? leaveStats(user.tenant_id) : null,
    listLeaveRequests(user.tenant_id, { userId: user.id }),
    listLeaveRequests(user.tenant_id, { awaitingUserId: user.id }),
    seesTeam ? listLeaveRequests(user.tenant_id, { status: sp.status }) : [],
  ]);

  const activeTypes = types.filter((t) => t.is_active);
  const chainLabel = settings.leave_approval_stages.map(titleCase).join(" → ");

  return (
    <>
      <PageHeader
        title="Leave"
        description={`Approval chain: Employee → ${chainLabel || "Company Admin"}. Entitlements reset each calendar year.`}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Waiting on you"
          value={queue.length}
          sub={queue.length ? "Decide below" : "Your queue is clear"}
          icon={<Check size={16} />}
          tone={queue.length ? "warning" : "success"}
        />
        {stats ? (
          <>
            <KpiCard label="Pending company-wide" value={stats.pending} tone={stats.pending ? "info" : "default"} />
            <KpiCard label="On leave today" value={stats.on_leave_today} icon={<CalendarDays size={16} />} />
            <KpiCard
              label={`Approved days in ${year}`}
              value={num(stats.days_this_year, 1)}
              sub={`${stats.approved_this_year} requests`}
            />
          </>
        ) : (
          balances.slice(0, 3).map((b) => (
            <KpiCard
              key={b.id}
              label={b.name}
              value={`${num(Math.max(0, b.entitled + b.carried_forward - b.taken), 1)} left`}
              sub={`${num(b.taken, 1)} of ${num(b.entitled + b.carried_forward, 1)} days used`}
            />
          ))
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          {queue.length > 0 && (
            <Card title="Awaiting your decision" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {queue.map((r) => (
                  <li key={r.id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <Avatar name={r.full_name} size={34} />
                        <div className="min-w-0">
                          <p className="font-medium">{r.full_name}</p>
                          <p className="text-sm text-fg-muted">
                            {r.leave_type} · {num(r.days, 1)} day{Number(r.days) === 1 ? "" : "s"} ·{" "}
                            {formatDate(r.start_date)} – {formatDate(r.end_date)}
                          </p>
                          {r.reason && (
                            <p className="mt-1.5 text-sm text-fg-muted italic">
                              &ldquo;{r.reason}&rdquo;
                            </p>
                          )}
                          <p className="mt-1 text-xs text-fg-subtle">
                            Stage {r.current_stage} of {r.total_stages}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <ActionButton
                          action={decideLeaveAction}
                          values={{ requestId: r.id, decision: "approved" }}
                          label="Approve"
                          className="btn-primary btn-sm"
                          icon={<Check size={14} />}
                        />
                        <ActionButton
                          action={decideLeaveAction}
                          values={{ requestId: r.id, decision: "rejected" }}
                          label="Decline"
                          className="btn-secondary btn-sm"
                          confirm={`Decline ${r.full_name}'s leave request?`}
                          icon={<X size={14} />}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="My requests" bodyClassName="p-0">
            {mine.length === 0 ? (
              <EmptyState
                icon={<CalendarDays size={20} />}
                title="No leave requested yet"
                description="Use the form to request time off."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Dates</th>
                      <th className="right">Days</th>
                      <th>Awaiting</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((r) => (
                      <tr key={r.id}>
                        <td className="font-medium">{r.leave_type}</td>
                        <td className="text-fg-muted">
                          {formatDate(r.start_date)} – {formatDate(r.end_date)}
                        </td>
                        <td className="right">{num(r.days, 1)}</td>
                        <td className="text-fg-muted">
                          {r.status === "pending"
                            ? (r.awaiting_name ?? `Stage ${r.current_stage}`)
                            : "—"}
                        </td>
                        <td>
                          <StatusBadge status={r.status} />
                        </td>
                        <td>
                          {r.status === "pending" && (
                            <ActionButton
                              action={cancelLeaveAction}
                              values={{ requestId: r.id }}
                              label="Cancel"
                              className="btn-ghost btn-sm"
                              confirm="Cancel this leave request?"
                              icon={<CircleSlash size={14} />}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {seesTeam && (
            <Card title="All leave requests" bodyClassName="p-0">
              <FilterBar
                filters={[
                  {
                    name: "status",
                    label: "Status",
                    type: "select",
                    value: sp.status,
                    options: ["pending", "approved", "rejected", "cancelled"].map((s) => ({
                      value: s,
                      label: s[0].toUpperCase() + s.slice(1),
                    })),
                  },
                ]}
              />
              {all.length === 0 ? (
                <EmptyState icon={<CalendarDays size={20} />} title="Nothing to show" />
              ) : (
                <div className="table-wrap max-h-[30rem] overflow-y-auto scroll-thin">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Type</th>
                        <th>Dates</th>
                        <th className="right">Days</th>
                        <th>Awaiting</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {all.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <span className="flex items-center gap-2.5">
                              <Avatar name={r.full_name} size={26} />
                              <span className="font-medium truncate">{r.full_name}</span>
                            </span>
                          </td>
                          <td className="text-fg-muted">{r.leave_type}</td>
                          <td className="text-fg-muted">
                            {formatDate(r.start_date)} – {formatDate(r.end_date)}
                          </td>
                          <td className="right">{num(r.days, 1)}</td>
                          <td className="text-fg-muted">
                            {r.status === "pending" ? (r.awaiting_name ?? "—") : "—"}
                          </td>
                          <td>
                            <StatusBadge status={r.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="grid gap-4">
          <Card title="Request leave">
            <AutoForm
              action={requestLeaveAction}
              columns={1}
              submitLabel="Submit request"
              resetOnSuccess
              fields={[
                {
                  name: "leaveTypeId",
                  label: "Leave type",
                  type: "select",
                  required: true,
                  options: activeTypes.map((t) => ({
                    value: t.id,
                    label: `${t.name}${t.annual_quota ? ` (${num(t.annual_quota, 0)} days/yr)` : ""}`,
                  })),
                },
                { name: "startDate", label: "From", type: "date", required: true, defaultValue: isoDate() },
                { name: "endDate", label: "To", type: "date", required: true, defaultValue: isoDate() },
                { name: "reason", label: "Reason", type: "textarea", rows: 2 },
              ]}
            />
          </Card>

          <Card title={`My ${year} entitlement`}>
            <ul className="space-y-4">
              {balances.map((b) => {
                const total = b.entitled + b.carried_forward;
                const left = Math.max(0, total - b.taken);
                return (
                  <li key={b.id}>
                    <div className="flex items-baseline justify-between gap-3 mb-1.5">
                      <span className="text-sm font-medium flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ background: b.color }}
                        />
                        {b.name}
                        {!b.is_paid && (
                          <span className="badge badge-neutral">unpaid</span>
                        )}
                      </span>
                      <span className="text-sm tnum">
                        <strong>{num(left, 1)}</strong>
                        <span className="text-fg-subtle"> / {num(total, 1)}</span>
                      </span>
                    </div>
                    <Progress value={b.taken} max={total || 1} />
                  </li>
                );
              })}
            </ul>
          </Card>

          {hasPermission(user, "leave", "create") && (
            <Card title="Leave types">
              <ul className="space-y-2 mb-4">
                {types.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: t.color }} />
                      <span className="truncate">{t.name}</span>
                    </span>
                    <span className="text-fg-subtle tnum shrink-0">
                      {num(t.annual_quota, 0)} d
                    </span>
                  </li>
                ))}
              </ul>
              <div className="pt-4 border-t border-border">
                <p className="text-[0.8125rem] font-semibold mb-3 flex items-center gap-1.5">
                  <Plus size={14} />
                  Add a type
                </p>
                <AutoForm
                  action={createLeaveTypeAction}
                  columns={1}
                  compact
                  resetOnSuccess
                  submitLabel="Add leave type"
                  fields={[
                    { name: "name", label: "Name", required: true, placeholder: "e.g. Study leave" },
                    { name: "annualQuota", label: "Days per year", type: "number", min: 0, step: "0.5", defaultValue: 0 },
                    { name: "isPaid", label: "Paid leave", type: "checkbox", defaultValue: true },
                  ]}
                />
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
