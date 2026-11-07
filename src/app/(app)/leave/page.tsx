import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Check, ChevronLeft, ChevronRight, CircleSlash, Plus, Users, X } from "lucide-react";
import { canSeeEveryone, hasPermission, requirePermission } from "@/lib/permissions";
import {
  holidaysBetween,
  leaveBalances,
  leaveCalendar,
  leaveStats,
  listLeaveRequests,
  listLeaveTypes,
  onLeaveToday,
} from "@/lib/leave";
import { getSettings } from "@/lib/settings";
import { weekStartDay } from "@/lib/work-pattern";
import LeaveCalendar from "@/components/LeaveCalendar";
import {
  cancelLeaveAction,
  createLeaveTypeAction,
  decideLeaveAction,
  requestLeaveAction,
} from "@/lib/actions/leave";
import { importLeaveAllotmentAction } from "@/lib/actions/import";
import ActionButton from "@/components/ActionButton";
import AutoForm from "@/components/forms/AutoForm";
import CsvImport from "@/components/forms/CsvImport";
import FilterBar from "@/components/FilterBar";
import { Avatar, Card, EmptyState, KpiCard, PageHeader, Progress, StatusBadge } from "@/components/ui";
import { addDays, formatDate, isoDate, monthName, monthWindow, num, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Leave" };

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; month?: string }>;
}) {
  const user = await requirePermission("leave", "view");
  const tz = user.tenant.timezone;
  const sp = await searchParams;
  const today = isoDate(tz);
  const year = Number(today.slice(0, 4));

  const seesTeam = canSeeEveryone(user, "leave");
  /*
     The calendar is company-wide, so it sits behind the same boundary as the
     "All leave requests" table: an ordinary employee sees their own requests
     and nobody else's. Who is on *sick* leave is not a fact to publish to
     every colleague by default.
  */
  const win = monthWindow(sp.month, today.slice(0, 7));

  const [types, balances, settings, stats, mine, queue, all, calendar, awayToday, holidays] =
    await Promise.all([
      listLeaveTypes(user.tenant_id),
      leaveBalances(user.tenant_id, user.id, year),
      getSettings(user.tenant_id),
      seesTeam ? leaveStats(user.tenant_id, tz) : null,
      listLeaveRequests(user.tenant_id, { userId: user.id }),
      listLeaveRequests(user.tenant_id, { awaitingUserId: user.id }),
      seesTeam ? listLeaveRequests(user.tenant_id, { status: sp.status }) : [],
      seesTeam ? leaveCalendar(user.tenant_id, win.from, win.to) : [],
      seesTeam ? onLeaveToday(user.tenant_id, today) : [],
      seesTeam ? holidaysBetween(user.tenant_id, win.from, win.to) : [],
    ]);

  const activeTypes = types.filter((t) => t.is_active);
  const chainLabel = settings.leave_approval_stages.map(titleCase).join(" → ");

  // Both links have to carry the other's parameter, or paging the calendar
  // would silently clear the status filter and vice versa.
  const hrefFor = (next: { month?: string; status?: string }) => {
    const p = new URLSearchParams();
    const month = next.month ?? win.month;
    const status = next.status ?? sp.status;
    if (month !== today.slice(0, 7)) p.set("month", month);
    if (status) p.set("status", status);
    const q = p.toString();
    return q ? `/leave?${q}` : "/leave";
  };

  /*
     Today's absences grouped by the department that has to cover them. A
     reduce rather than a GROUP BY because the rows are already here for the
     table below — a second query to count what is in front of us would be
     the more wasteful of the two.
  */
  const byDepartment = [...
    awayToday.reduce((m, e) => {
      const key = e.department ?? "No department";
      return m.set(key, (m.get(key) ?? 0) + 1);
    }, new Map<string, number>()),
  ].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

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
                            {formatDate(r.start_date, tz)} – {formatDate(r.end_date, tz)}
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

          {seesTeam && (
            <Card
              title="On leave today"
              bodyClassName="p-0"
              action={
                <span className="text-sm text-fg-muted">
                  {formatDate(today, tz)}
                </span>
              }
            >
              {awayToday.length === 0 ? (
                <EmptyState
                  icon={<Users size={20} />}
                  title="Everybody is in"
                  description="No approved leave covers today."
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5 border-b border-border bg-surface-2">
                    <span className="text-sm">
                      <strong className="tnum text-base">{awayToday.length}</strong>{" "}
                      {awayToday.length === 1 ? "person" : "people"} away across{" "}
                      <strong className="tnum">{byDepartment.length}</strong>{" "}
                      {byDepartment.length === 1 ? "department" : "departments"}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {byDepartment.map(([dept, count]) => (
                        <span key={dept} className="badge badge-neutral">
                          {dept} · {count}
                        </span>
                      ))}
                    </span>
                  </div>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Department</th>
                          <th>Leave type</th>
                          <th>Back on</th>
                        </tr>
                      </thead>
                      <tbody>
                        {awayToday.map((e) => (
                          <tr key={e.id}>
                            <td>
                              <span className="flex items-center gap-2.5">
                                <Avatar name={e.full_name} url={e.avatar_url} size={28} />
                                <span className="min-w-0">
                                  <span className="block font-medium truncate">
                                    {e.full_name}
                                  </span>
                                  {e.designation && (
                                    <span className="block text-xs text-fg-subtle truncate">
                                      {e.designation}
                                    </span>
                                  )}
                                </span>
                              </span>
                            </td>
                            <td className="text-fg-muted">{e.department ?? "—"}</td>
                            <td>
                              <span className="flex items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 rounded-sm shrink-0"
                                  style={{ background: e.color }}
                                />
                                {e.leave_type}
                              </span>
                            </td>
                            {/* The first day back, not the last day off: the
                                question a cover rota actually asks. */}
                            <td className="text-fg-muted">
                              {formatDate(addDays(e.end_date, 1), tz)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>
          )}

          {seesTeam && (
            <Card
              title="Leave calendar"
              action={
                win.month !== today.slice(0, 7) ? (
                  <Link href={hrefFor({ month: today.slice(0, 7) })} className="btn btn-ghost btn-sm">
                    Back to today
                  </Link>
                ) : null
              }
            >
              {/* The month and its arrows sit in the body rather than the card
                  head, and the arrows carry no month name: this column is
                  narrow at every width, and a head holding all three wrapped
                  the title across three lines. The month each arrow leads to
                  is in its label, where a screen reader and a tooltip find
                  it. */}
              <div className="flex items-center justify-between gap-2 mb-3">
                <Link
                  href={hrefFor({ month: win.earlier })}
                  className="btn btn-ghost btn-icon"
                  title={`${monthName(Number(win.earlier.slice(5)))} ${win.earlier.slice(0, 4)}`}
                  aria-label={`Previous month, ${monthName(Number(win.earlier.slice(5)))} ${win.earlier.slice(0, 4)}`}
                >
                  <ChevronLeft size={16} />
                </Link>
                <h3 className="font-semibold tracking-tight">
                  {monthName(win.monthNumber)} {win.year}
                </h3>
                <Link
                  href={hrefFor({ month: win.later })}
                  className="btn btn-ghost btn-icon"
                  title={`${monthName(Number(win.later.slice(5)))} ${win.later.slice(0, 4)}`}
                  aria-label={`Next month, ${monthName(Number(win.later.slice(5)))} ${win.later.slice(0, 4)}`}
                >
                  <ChevronRight size={16} />
                </Link>
              </div>
              <LeaveCalendar
                entries={calendar}
                from={win.from}
                to={win.to}
                today={today}
                weekStart={weekStartDay(settings.weekend_days)}
                weekendDays={settings.weekend_days ?? []}
                holidays={holidays}
                timeZone={tz}
                canOpenProfile={hasPermission(user, "employees", "view")}
              />
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
                          {formatDate(r.start_date, tz)} – {formatDate(r.end_date, tz)}
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
              >
                {/* A GET form posts only its own fields, so the month the
                    calendar is showing has to ride along or applying a status
                    filter would snap the calendar back to today. */}
                <input type="hidden" name="month" value={win.month} />
              </FilterBar>
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
                            {formatDate(r.start_date, tz)} – {formatDate(r.end_date, tz)}
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
                { name: "startDate", label: "From", type: "date", required: true, defaultValue: isoDate(tz) },
                { name: "endDate", label: "To", type: "date", required: true, defaultValue: isoDate(tz) },
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

          {hasPermission(user, "leave", "edit") && (
            <Card title="Annual allotment">
              <CsvImport
                action={importLeaveAllotmentAction}
                templateHref={`/api/templates/leave?year=${year}`}
                templateLabel={`Download ${year} allotment sheet`}
                submitLabel="Import allotments"
                note={
                  <>
                    The sheet comes out already filled: one row per active employee, one
                    column per leave category, every cell holding what they are entitled
                    to today. Change the figures that are wrong and upload it back. A
                    cell left <em>blank</em> means &ldquo;leave this category alone&rdquo;
                    — which is not the same as typing 0.
                  </>
                }
              >
                <div className="max-w-40">
                  <label className="label" htmlFor="allotment-year">
                    Leave year
                  </label>
                  <input
                    id="allotment-year"
                    name="year"
                    type="number"
                    min={2000}
                    max={2100}
                    defaultValue={year}
                    className="input"
                  />
                </div>
              </CsvImport>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
