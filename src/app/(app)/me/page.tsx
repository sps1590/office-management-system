import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, Satellite } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getEmployee } from "@/lib/employees";
import { leaveBalances } from "@/lib/leave";
import { myPayslips } from "@/lib/payroll";
import { attendanceRange } from "@/lib/attendance";
import { changePasswordAction } from "@/lib/actions/employees";
import AutoForm from "@/components/forms/AutoForm";
import { Avatar, Card, Field, KpiCard, PageHeader, Progress, StatusBadge } from "@/components/ui";
import { duration, formatDate, isoDate, money, monthName, num } from "@/lib/utils";

export const metadata: Metadata = { title: "My profile" };

export default async function MyProfilePage() {
  const user = await requireUser();
  const tz = user.tenant.timezone;
  const year = Number(isoDate(tz).slice(0, 4));
  const from = new Date();
  from.setDate(from.getDate() - 29);

  const [profile, balances, payslips, attendance] = await Promise.all([
    getEmployee(user.tenant_id, user.id),
    leaveBalances(user.tenant_id, user.id, year),
    myPayslips(user.tenant_id, user.id),
    attendanceRange(user.tenant_id, user.id, isoDate(tz, from), isoDate(tz)),
  ]);

  const currency = user.tenant.currency;

  const present = attendance.filter((a) => ["present", "late"].includes(a.status)).length;
  const overtime = attendance.reduce((s, a) => s + a.overtime_minutes, 0);
  const latestPayslip = payslips[0];

  return (
    <>
      <PageHeader title="My profile" description={user.email}>
        <Link href="/tracker" className="btn btn-secondary">
          <Satellite size={15} />
          Field tracker
        </Link>
      </PageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Present, last 30 days" value={present} tone="success" />
        <KpiCard label="Overtime, last 30 days" value={duration(overtime)} />
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

          <Card title="My attendance, last 30 days" bodyClassName="p-0">
            <div className="table-wrap max-h-80 overflow-y-auto scroll-thin">
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="right">Worked</th>
                    <th className="right">Overtime</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-fg-subtle">
                        Nothing recorded yet.
                      </td>
                    </tr>
                  ) : (
                    attendance.map((a) => (
                      <tr key={a.id}>
                        <td>{formatDate(a.work_date, tz)}</td>
                        <td className="right">{duration(a.worked_minutes)}</td>
                        <td className="right">
                          {a.overtime_minutes > 0 ? duration(a.overtime_minutes) : "—"}
                        </td>
                        <td>
                          <StatusBadge status={a.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
