import type { Metadata } from "next";
import { CalendarClock, Clock, TimerOff, UserCheck, Users } from "lucide-react";
import { canSeeEveryone, hasPermission, requirePermission } from "@/lib/permissions";
import {
  attendanceForDate,
  attendanceRange,
  attendanceSummary,
  attendanceTrend,
  todaysAttendance,
} from "@/lib/attendance";
import { listDepartments, pickableUsers } from "@/lib/employees";
import { getSettings } from "@/lib/settings";
import { manualAttendanceAction } from "@/lib/actions/attendance";
import { AreaChart } from "@/components/charts";
import CheckInWidget from "@/components/CheckInWidget";
import FilterBar from "@/components/FilterBar";
import AutoForm from "@/components/forms/AutoForm";
import { Avatar, Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { duration, formatDate, formatTime, isoDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; department?: string }>;
}) {
  const user = await requirePermission("attendance", "view");
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : isoDate();

  const seesTeam = canSeeEveryone(user, "attendance");
  const canEdit = hasPermission(user, "attendance", "edit");

  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 29);

  const [today, settings, mine, summary, trend, team, departments, people] =
    await Promise.all([
      todaysAttendance(user.tenant_id, user.id),
      getSettings(user.tenant_id),
      attendanceRange(user.tenant_id, user.id, isoDate(monthAgo), isoDate()),
      seesTeam ? attendanceSummary(user.tenant_id, date) : null,
      seesTeam ? attendanceTrend(user.tenant_id, 21) : null,
      seesTeam
        ? attendanceForDate(user.tenant_id, date, { departmentId: sp.department })
        : null,
      seesTeam ? listDepartments(user.tenant_id) : [],
      canEdit ? pickableUsers(user.tenant_id) : [],
    ]);

  const myPresent = mine.filter((a) => ["present", "late"].includes(a.status)).length;
  const myOvertime = mine.reduce((s, a) => s + a.overtime_minutes, 0);
  const myLate = mine.reduce((s, a) => s + (a.late_minutes > 0 ? 1 : 0), 0);

  return (
    <>
      <PageHeader
        title="Attendance"
        description={`Standard day ${duration(settings.standard_work_minutes)} from ${settings.work_start_time.slice(
          0,
          5
        )}, ${settings.grace_minutes} minutes grace. Overtime after ${duration(
          settings.overtime_after_minutes
        )} at ${settings.overtime_multiplier}×.`}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CheckInWidget
          checkedInAt={today?.check_in_at ?? null}
          checkedOutAt={today?.check_out_at ?? null}
          workedMinutes={today?.worked_minutes ?? 0}
          requiresLocation={settings.require_geofenced_checkin}
        />
        <KpiCard
          label="My present days, last 30"
          value={myPresent}
          icon={<UserCheck size={16} />}
          tone="success"
        />
        <KpiCard
          label="My overtime, last 30 days"
          value={duration(myOvertime)}
          icon={<Clock size={16} />}
        />
        <KpiCard
          label="My late arrivals, last 30"
          value={myLate}
          icon={<TimerOff size={16} />}
          tone={myLate > 3 ? "warning" : "default"}
        />
      </section>

      {seesTeam && summary && trend && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mt-4">
            <KpiCard
              label={`Present on ${formatDate(date)}`}
              value={`${summary.present}/${summary.headcount}`}
              sub={`${summary.still_in} still checked in`}
              icon={<Users size={16} />}
              tone="success"
            />
            <KpiCard label="Late" value={summary.late} tone={summary.late > 0 ? "warning" : "default"} />
            <KpiCard label="On leave" value={summary.on_leave} tone="info" />
            <KpiCard
              label="Absent"
              value={summary.absent}
              tone={summary.absent > 0 ? "danger" : "success"}
            />
          </section>

          <Card title="Company attendance, last 21 days" className="mt-4">
            <AreaChart data={trend} height={190} />
          </Card>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2 mt-4 items-start">
        {seesTeam && team && (
          <Card title={`Team register — ${formatDate(date)}`} bodyClassName="p-0">
            <FilterBar
              filters={[
                { name: "date", label: "Date", type: "date", value: date },
                {
                  name: "department",
                  label: "Department",
                  type: "select",
                  value: sp.department,
                  options: departments.map((d) => ({ value: d.id, label: d.name })),
                },
              ]}
            />
            {team.length === 0 ? (
              <EmptyState
                icon={<CalendarClock size={20} />}
                title="No attendance recorded"
                description="Nobody has checked in for this date yet."
              />
            ) : (
              <div className="table-wrap max-h-[32rem] overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>In</th>
                      <th>Out</th>
                      <th className="right">Worked</th>
                      <th className="right">OT</th>
                      <th>Status</th>
                      <th>Geofence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <span className="flex items-center gap-2.5">
                            <Avatar name={a.full_name} size={26} />
                            <span className="min-w-0">
                              <span className="block font-medium truncate">{a.full_name}</span>
                              <span className="block text-xs text-fg-subtle truncate">
                                {a.department_name ?? a.employee_code ?? "—"}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td>{formatTime(a.check_in_at)}</td>
                        <td>{formatTime(a.check_out_at)}</td>
                        <td className="right">{duration(a.worked_minutes)}</td>
                        <td className="right">
                          {a.overtime_minutes > 0 ? duration(a.overtime_minutes) : "—"}
                        </td>
                        <td>
                          <StatusBadge status={a.status} />
                        </td>
                        <td>
                          {a.inside_geofence === null ? (
                            <span className="text-fg-subtle text-xs">—</span>
                          ) : a.inside_geofence ? (
                            <span className="badge badge-success">Inside</span>
                          ) : (
                            <span className="badge badge-warning">Outside</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        <div className="grid gap-4">
          <Card title="My last 30 days" bodyClassName="p-0">
            {mine.length === 0 ? (
              <EmptyState
                icon={<CalendarClock size={20} />}
                title="Nothing recorded yet"
                description="Your attendance appears here once you check in."
              />
            ) : (
              <div className="table-wrap max-h-96 overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>In</th>
                      <th>Out</th>
                      <th className="right">Worked</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((a) => (
                      <tr key={a.id}>
                        <td>{formatDate(a.work_date)}</td>
                        <td>{formatTime(a.check_in_at)}</td>
                        <td>{formatTime(a.check_out_at)}</td>
                        <td className="right">{duration(a.worked_minutes)}</td>
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

          {canEdit && (
            <Card title="Record attendance manually">
              <p className="text-sm text-fg-muted mb-4">
                For a missed check-in, a disputed day, or recording leave and holidays.
                Entries made here are marked as manual in the register and in the audit log.
              </p>
              <AutoForm
                action={manualAttendanceAction}
                submitLabel="Save entry"
                resetOnSuccess
                fields={[
                  {
                    name: "userId",
                    label: "Employee",
                    type: "select",
                    required: true,
                    options: people.map((p) => ({ value: p.id, label: p.full_name })),
                  },
                  { name: "workDate", label: "Date", type: "date", required: true, defaultValue: date },
                  { name: "checkIn", label: "Check in", type: "time" },
                  { name: "checkOut", label: "Check out", type: "time" },
                  {
                    name: "status",
                    label: "Status",
                    type: "select",
                    required: true,
                    defaultValue: "present",
                    options: [
                      "present",
                      "late",
                      "absent",
                      "half_day",
                      "on_leave",
                      "holiday",
                      "weekend",
                    ].map((s) => ({ value: s, label: s.replace(/_/g, " ") })),
                  },
                  { name: "note", label: "Note", type: "textarea", span: 2, rows: 2 },
                ]}
              />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
