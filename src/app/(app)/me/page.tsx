import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, Satellite } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getEmployee } from "@/lib/employees";
import { leaveBalances } from "@/lib/leave";
import { myPayslips } from "@/lib/payroll";
import { timesheet } from "@/lib/attendance";
import { getSettings } from "@/lib/settings";
import { shiftForUser } from "@/lib/shifts";
import { DAY_NAMES, shiftMinutes, workDaysLabel } from "@/lib/work-pattern";
import { changePasswordAction } from "@/lib/actions/employees";
import AutoForm from "@/components/forms/AutoForm";
import { Avatar, Card, Field, KpiCard, PageHeader, Progress, StatusBadge } from "@/components/ui";
import { addDays, duration, formatDate, isoDate, money, monthName, num } from "@/lib/utils";

export const metadata: Metadata = { title: "My profile" };

export default async function MyProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireUser();
  const tz = user.tenant.timezone;
  const today = isoDate(tz);
  const year = Number(today.slice(0, 4));
  const sp = await searchParams;

  /*
     A timesheet is a monthly artefact, so the period is a calendar month in
     the company's zone -- not a rolling thirty days, which never lines up
     with the month somebody is actually being paid for. `?month=YYYY-MM`
     looks back; anything else falls to the current one.
  */
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? (sp.month as string) : today.slice(0, 7);
  const from = `${month}-01`;
  // The 1st of next month, minus a day. Derived rather than looked up in a
  // table of month lengths, so February and leap years need no special case.
  const [my, mm] = month.split("-").map(Number);
  const nextMonth = mm === 12 ? `${my + 1}-01-01` : `${my}-${String(mm + 1).padStart(2, "0")}-01`;
  const to = addDays(nextMonth, -1);

  const settings = await getSettings(user.tenant_id);
  const shift = await shiftForUser(user.tenant_id, user.id);

  const [profile, balances, payslips, sheet] = await Promise.all([
    getEmployee(user.tenant_id, user.id),
    leaveBalances(user.tenant_id, user.id, year),
    myPayslips(user.tenant_id, user.id),
    timesheet(user.tenant_id, user.id, from, to, settings, shift, tz),
  ]);

  const currency = user.tenant.currency;
  const totals = sheet.totals;
  const latestPayslip = payslips[0];

  const patternHours = shift ? shiftMinutes(shift) : settings.standard_work_minutes;
  const patternDays = shift
    ? workDaysLabel(shift.work_days)
    : workDaysLabel([0, 1, 2, 3, 4, 5, 6].filter((d) => !(settings.weekend_days ?? []).includes(d)));
  const startsAt = (shift?.start_time ?? settings.work_start_time).slice(0, 5);
  // Month navigation: one step back is always offered, one step forward only
  // when there is a month to go forward to.
  const step = (n: number) => {
    const m = mm + n;
    const y = my + Math.floor((m - 1) / 12);
    const wrapped = ((m - 1) % 12 + 12) % 12 + 1;
    return `${y}-${String(wrapped).padStart(2, "0")}`;
  };
  const earlier = step(-1);
  const later = month < today.slice(0, 7) ? step(1) : null;

  return (
    <>
      <PageHeader title="My profile" description={user.email}>
        <Link href="/tracker" className="btn btn-secondary">
          <Satellite size={15} />
          Field tracker
        </Link>
      </PageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Hours this month"
          value={duration(totals.workedMinutes)}
          sub={`of ${duration(totals.expectedMinutes)} expected`}
          tone={totals.balanceMinutes >= 0 ? "success" : "warning"}
        />
        <KpiCard
          label={totals.balanceMinutes >= 0 ? "Ahead by" : "Short by"}
          value={duration(Math.abs(totals.balanceMinutes))}
          sub={`${totals.presentDays} of ${totals.workingDays} working days`}
        />
        <KpiCard
          label="Leave remaining"
          value={num(
            balances.reduce(
              (s, b) => s + Math.max(0, b.entitled + b.carried_forward - b.taken),
              0
            ),
            1
          )}
          sub={`across ${balances.length} leave types`}
        />
        <KpiCard
          label="Latest payslip"
          value={latestPayslip ? money(latestPayslip.net_pay, currency) : "—"}
          sub={
            latestPayslip
              ? `${monthName(latestPayslip.period_month)} ${latestPayslip.period_year}`
              : "No payslip yet"
          }
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr] mt-4 items-start">
        <div className="grid gap-4">
          <Card>
            <div className="flex items-center gap-3.5">
              <Avatar name={user.full_name} url={user.avatar_url} size={56} />
              <div className="min-w-0">
                <p className="font-semibold tracking-tight truncate">{user.full_name}</p>
                <p className="text-sm text-fg-muted truncate">
                  {user.designation ?? "—"}
                </p>
                {user.role_name && (
                  <span className="badge badge-primary mt-1.5">{user.role_name}</span>
                )}
              </div>
            </div>
          </Card>

          <Card title="My details">
            <dl>
              <Field label="Company">{user.tenant.company_name}</Field>
              <Field label="Employee code">{user.employee_code ?? "—"}</Field>
              <Field label="Department">{user.department_name ?? "—"}</Field>
              <Field label="Phone">{user.phone ?? "—"}</Field>
              <Field label="Joined">{formatDate(profile?.date_of_joining, tz)}</Field>
              <Field label="Employment type">
                <span className="capitalize">{profile?.employment_type ?? "—"}</span>
              </Field>
            </dl>
            <p className="help mt-3">
              To correct any of this, ask HR — the directory is maintained centrally.
            </p>
          </Card>

          <Card title="Change password">
            <AutoForm
              action={changePasswordAction}
              columns={1}
              submitLabel="Update password"
              resetOnSuccess
              fields={[
                { name: "current", label: "Current password", type: "password", required: true },
                { name: "next", label: "New password", type: "password", required: true, help: "At least 8 characters, with upper case, lower case and a number." },
                { name: "confirm", label: "Confirm new password", type: "password", required: true },
              ]}
              footer={<KeyRound size={15} className="text-fg-subtle" />}
            />
          </Card>
        </div>

        <div className="grid gap-4">
          <Card title={`My ${year} leave entitlement`}>
            <ul className="space-y-4">
              {balances.map((b) => {
                const total = b.entitled + b.carried_forward;
                return (
                  <li key={b.id}>
                    <div className="flex items-baseline justify-between gap-3 mb-1.5">
                      <span className="text-sm font-medium">{b.name}</span>
                      <span className="text-sm tnum">
                        <strong>{num(Math.max(0, total - b.taken), 1)}</strong>
                        <span className="text-fg-subtle"> / {num(total, 1)} days</span>
                      </span>
                    </div>
                    <Progress value={b.taken} max={total || 1} />
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="My payslips" bodyClassName="p-0">
            {payslips.length === 0 ? (
              <p className="px-5 py-5 text-sm text-fg-subtle">
                Payslips appear here once a payroll run is approved.
              </p>
            ) : (
              <div className="table-wrap max-h-72 overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th className="right">Gross</th>
                      <th className="right">Deductions</th>
                      <th className="right">Net</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payslips.map((p) => (
                      <tr key={p.id}>
                        <td className="font-medium">
                          {monthName(p.period_month)} {p.period_year}
                        </td>
                        <td className="right">{money(p.gross, currency)}</td>
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

          <Card
            title={`Timesheet — ${monthName(mm)} ${my}`}
            bodyClassName="p-0"
            action={
              <div className="flex items-center gap-1.5">
                <Link href={`/me?month=${earlier}`} className="btn btn-ghost btn-sm">
                  ← {monthName(Number(earlier.slice(5)))}
                </Link>
                {later && (
                  <Link href={`/me?month=${later}`} className="btn btn-ghost btn-sm">
                    {monthName(Number(later.slice(5)))} →
                  </Link>
                )}
              </div>
            }
          >
            <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-fg-muted">
              <span>
                <strong className="text-fg">{sheet.shiftName ?? "Company default"}</strong>{" "}
                · {startsAt}, {duration(patternHours)} a day · {patternDays}
              </span>
              {totals.lateMinutes > 0 && <span>Late {duration(totals.lateMinutes)} in total</span>}
              {totals.overtimeMinutes > 0 && (
                <span>Overtime {duration(totals.overtimeMinutes)}</span>
              )}
              {totals.absentDays > 0 && (
                <span className="text-warning">
                  {totals.absentDays} unexplained absence{totals.absentDays === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <div className="table-wrap max-h-[30rem] overflow-y-auto scroll-thin">
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    <th className="right">Expected</th>
                    <th className="right">Worked</th>
                    <th className="right">Late</th>
                    <th className="right">Overtime</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.days.map((d) => (
                    <tr key={d.date} data-muted={!d.working || undefined}>
                      <td className={d.date === today ? "font-semibold" : undefined}>
                        {formatDate(d.date, tz)}
                      </td>
                      <td className="text-fg-subtle">{DAY_NAMES[d.weekday].slice(0, 3)}</td>
                      <td className="right text-fg-muted">
                        {d.expectedMinutes > 0 ? duration(d.expectedMinutes) : "—"}
                      </td>
                      <td className="right">
                        {d.workedMinutes > 0 ? duration(d.workedMinutes) : "—"}
                      </td>
                      <td className="right text-fg-muted">
                        {d.lateMinutes > 0 ? duration(d.lateMinutes) : "—"}
                      </td>
                      <td className="right text-fg-muted">
                        {d.overtimeMinutes > 0 ? duration(d.overtimeMinutes) : "—"}
                      </td>
                      <td>
                        {d.holidayName ? (
                          <span className="badge badge-neutral" title={d.holidayName}>
                            {d.holidayName}
                          </span>
                        ) : d.leaveType ? (
                          <span className="badge badge-primary">{d.leaveType}</span>
                        ) : d.status === "rest_day" ? (
                          <span className="text-fg-subtle text-xs">Rest day</span>
                        ) : d.status === "scheduled" ? (
                          <span className="text-fg-subtle text-xs">—</span>
                        ) : (
                          <StatusBadge status={d.status} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold border-t-2 border-border">
                    <td colSpan={2}>
                      {totals.workingDays} working days
                      {totals.leaveDays > 0 && `, ${totals.leaveDays} on leave`}
                    </td>
                    <td className="right">{duration(totals.expectedMinutes)}</td>
                    <td className="right">{duration(totals.workedMinutes)}</td>
                    <td className="right">{duration(totals.lateMinutes)}</td>
                    <td className="right">{duration(totals.overtimeMinutes)}</td>
                    <td className={totals.balanceMinutes >= 0 ? "text-success" : "text-warning"}>
                      {totals.balanceMinutes >= 0 ? "+" : "−"}
                      {duration(Math.abs(totals.balanceMinutes))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="help px-5 py-3 border-t border-border">
              Expected hours come from{" "}
              {sheet.shiftName ? `the ${sheet.shiftName} shift` : "the company working week"}, set
              on the company settings screen. Rest days, public holidays and approved leave
              expect nothing, so they never count against the balance — and days still to
              come are left out of the totals entirely.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
