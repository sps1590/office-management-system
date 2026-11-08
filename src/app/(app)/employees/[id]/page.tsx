import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, UserCheck, UserMinus } from "lucide-react";
import { hasPermission, isCompanyAdmin, requirePermission } from "@/lib/permissions";
import { getEmployee } from "@/lib/employees";
import { attendanceRange } from "@/lib/attendance";
import { getDb } from "@/lib/db";
import { setUserStatusAction } from "@/lib/actions/employees";
import ActionButton from "@/components/ActionButton";
import SetPasswordDialog from "@/components/forms/SetPasswordDialog";
import { Avatar, Card, Field, PageHeader, StatusBadge } from "@/components/ui";
import { duration, formatDate, formatDateTime, formatTime, isoDate, money } from "@/lib/utils";

export const metadata: Metadata = { title: "Employee" };

export default async function EmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("employees", "view");
  const tz = user.tenant.timezone;
  const { id } = await params;

  const employee = await getEmployee(user.tenant_id, id);
  if (!employee) notFound();

  const db = await getDb();
  const from = new Date();
  from.setDate(from.getDate() - 29);

  const [attendance, leave, directReports] = await Promise.all([
    attendanceRange(user.tenant_id, id, isoDate(tz, from), isoDate(tz)),
    db`
      SELECT lr.id, lr.start_date, lr.end_date, lr.days, lr.status, lt.name AS leave_type
        FROM leave_requests lr
        JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.tenant_id = ${user.tenant_id} AND lr.user_id = ${id}
       ORDER BY lr.start_date DESC
       LIMIT 6
    `,
    db`
      SELECT id, full_name, designation FROM users
       WHERE tenant_id = ${user.tenant_id} AND line_manager_id = ${id} AND status = 'active'
       ORDER BY full_name
    `,
  ]);

  const currency = user.tenant.currency;

  const gross =
    employee.basic_salary +
    employee.house_rent +
    employee.medical_allowance +
    employee.transport_allowance +
    employee.other_allowance;

  const presentDays = attendance.filter((a) => ["present", "late"].includes(a.status)).length;
  const totalOvertime = attendance.reduce((s, a) => s + a.overtime_minutes, 0);
  // Salary is sensitive: visible to someone who can edit the directory (HR)
  // or to the person themselves, not to every colleague with view access.
  const canSeeSalary = hasPermission(user, "employees", "edit") || user.id === id;

  return (
    <>
      <Link href="/employees" className="btn btn-ghost btn-sm mb-4">
        <ArrowLeft size={15} />
        Directory
      </Link>

      <PageHeader title={employee.full_name} description={employee.designation ?? undefined}>
        {isCompanyAdmin(user) && employee.id !== user.id && (
          <>
            {/* Active and inactive, and nothing else: an employee record is
                never deleted, because their attendance, payslips, approvals
                and audit trail all hang off it. */}
            {employee.status === "active" ? (
              <ActionButton
                action={setUserStatusAction}
                values={{ userId: employee.id, status: "left" }}
                label="Mark inactive"
                className="btn-secondary"
                icon={<UserMinus size={15} />}
                confirm={`Mark ${employee.full_name} inactive? They will be signed out everywhere and will not be able to sign in. Nothing is deleted, and you can make them active again at any time.`}
              />
            ) : (
              <ActionButton
                action={setUserStatusAction}
                values={{ userId: employee.id, status: "active" }}
                label="Make active"
                className="btn-secondary"
                icon={<UserCheck size={15} />}
              />
            )}
            <SetPasswordDialog userId={employee.id} name={employee.full_name} />
          </>
        )}
        {hasPermission(user, "employees", "edit") && (
          <Link href={`/employees/${employee.id}/edit`} className="btn btn-secondary">
            <Pencil size={15} />
            Edit
          </Link>
        )}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr] items-start">
        <div className="grid gap-4">
          <Card>
            <div className="flex items-center gap-3.5">
              <Avatar name={employee.full_name} url={employee.avatar_url} size={56} />
              <div className="min-w-0">
                <p className="font-semibold tracking-tight truncate">{employee.full_name}</p>
                <p className="text-sm text-fg-muted truncate">{employee.email}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <StatusBadge status={employee.status} />
                  {employee.role_name && (
                    <span className="badge badge-primary">{employee.role_name}</span>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <Card title="Employment">
            <dl>
              <Field label="Employee code">{employee.employee_code ?? "—"}</Field>
              <Field label="Department">{employee.department_name ?? "—"}</Field>
              <Field label="Reports to">{employee.line_manager_name ?? "—"}</Field>
              <Field label="Type">
                <span className="capitalize">{employee.employment_type ?? "—"}</span>
              </Field>
              <Field label="Joined">{formatDate(employee.date_of_joining, tz)}</Field>
              {employee.probation_end_date && (
                <Field label="Probation ends">{formatDate(employee.probation_end_date, tz)}</Field>
              )}
              {employee.contract_end_date && (
                <Field label="Contract ends">{formatDate(employee.contract_end_date, tz)}</Field>
              )}
              <Field label="Last sign-in">
                {employee.last_login_at ? formatDateTime(employee.last_login_at, tz) : "Never"}
              </Field>
            </dl>
          </Card>

          <Card title="Contact">
            <dl>
              <Field label="Phone">{employee.phone ?? "—"}</Field>
              <Field label="Emergency">
                {employee.emergency_contact_name
                  ? `${employee.emergency_contact_name} · ${employee.emergency_contact_phone ?? ""}`
                  : "—"}
              </Field>
              <Field label="Blood group">{employee.blood_group ?? "—"}</Field>
              <Field label="Present address">{employee.present_address ?? "—"}</Field>
            </dl>
          </Card>

          {canSeeSalary && (
            <Card title={`Salary structure (${currency})`}>
              <dl>
                <Field label="Basic">{money(employee.basic_salary, currency)}</Field>
                <Field label="House rent">{money(employee.house_rent, currency)}</Field>
                <Field label="Medical">{money(employee.medical_allowance, currency)}</Field>
                <Field label="Transport">{money(employee.transport_allowance, currency)}</Field>
                <Field label="Other">{money(employee.other_allowance, currency)}</Field>
                <Field label="Gross monthly">
                  <strong>{money(gross, currency)}</strong>
                </Field>
                <Field label="Bank">
                  {employee.bank_name
                    ? `${employee.bank_name} · ${employee.bank_account ?? ""}`
                    : "—"}
                </Field>
              </dl>
            </Card>
          )}
        </div>

        <div className="grid gap-4">
          <section className="grid gap-4 sm:grid-cols-3">
            <div className="card p-5">
              <p className="text-[0.8125rem] text-fg-muted">Present, last 30 days</p>
              <p className="kpi-value mt-2">{presentDays}</p>
            </div>
            <div className="card p-5">
              <p className="text-[0.8125rem] text-fg-muted">Overtime, last 30 days</p>
              <p className="kpi-value mt-2">{duration(totalOvertime)}</p>
            </div>
            <div className="card p-5">
              <p className="text-[0.8125rem] text-fg-muted">Direct reports</p>
              <p className="kpi-value mt-2">{directReports.length}</p>
            </div>
          </section>

          <Card title="Attendance, last 30 days" bodyClassName="p-0">
            {attendance.length === 0 ? (
              <p className="px-5 py-6 text-sm text-fg-subtle text-center">
                No attendance recorded in this period.
              </p>
            ) : (
              <div className="table-wrap max-h-96 overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>In</th>
                      <th>Out</th>
                      <th className="right">Worked</th>
                      <th className="right">Overtime</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.map((a) => (
                      <tr key={a.id}>
                        <td>{formatDate(a.work_date, tz)}</td>
                        <td>{formatTime(a.check_in_at, tz)}</td>
                        <td>{formatTime(a.check_out_at, tz)}</td>
                        <td className="right">{duration(a.worked_minutes)}</td>
                        <td className="right">
                          {a.overtime_minutes > 0 ? duration(a.overtime_minutes) : "—"}
                        </td>
                        <td>
                          <StatusBadge status={a.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Recent leave" bodyClassName="p-0">
              {leave.length === 0 ? (
                <p className="px-5 py-5 text-sm text-fg-subtle">No leave requests.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(
                    leave as unknown as {
                      id: string;
                      start_date: string;
                      end_date: string;
                      days: number;
                      status: string;
                      leave_type: string;
                    }[]
                  ).map((l) => (
                    <li key={l.id} className="px-5 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{l.leave_type}</p>
                        <p className="text-xs text-fg-subtle">
                          {formatDate(l.start_date, tz)} – {formatDate(l.end_date, tz)} · {l.days} day
                          {Number(l.days) === 1 ? "" : "s"}
                        </p>
                      </div>
                      <StatusBadge status={l.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Direct reports" bodyClassName="p-0">
              {directReports.length === 0 ? (
                <p className="px-5 py-5 text-sm text-fg-subtle">No direct reports.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(
                    directReports as unknown as {
                      id: string;
                      full_name: string;
                      designation: string | null;
                    }[]
                  ).map((r) => (
                    <li key={r.id} className="px-5 py-3">
                      <Link
                        href={`/employees/${r.id}`}
                        className="flex items-center gap-2.5 hover:text-primary transition-colors"
                      >
                        <Avatar name={r.full_name} size={28} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium truncate">
                            {r.full_name}
                          </span>
                          <span className="block text-xs text-fg-subtle truncate">
                            {r.designation ?? "—"}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
