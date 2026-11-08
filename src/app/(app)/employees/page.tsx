import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { requirePermission, hasPermission } from "@/lib/permissions";
import {
  employeeStats,
  listDepartments,
  listEmployees,
  listRoles,
  pickableUsers,
} from "@/lib/employees";
import {
  createDepartmentAction,
  deleteDepartmentAction,
  updateDepartmentAction,
} from "@/lib/actions/employees";
import { importEmployeesAction } from "@/lib/actions/import";
import { Avatar, Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { RowBars } from "@/components/charts";
import FilterBar from "@/components/FilterBar";
import ActionButton from "@/components/ActionButton";
import AutoForm from "@/components/forms/AutoForm";
import EditDialog from "@/components/forms/EditDialog";
import CsvImport from "@/components/forms/CsvImport";
import { formatDate } from "@/lib/utils";

/*
   Importing hashes a bcrypt password per new account, about 60-130ms each, so
   a file of two hundred needs well past the default budget. The importer caps
   the file at two hundred rows; this gives those rows somewhere to finish.
*/
export const maxDuration = 60;

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; department?: string; status?: string; role?: string }>;
}) {
  const user = await requirePermission("employees", "view");
  const tz = user.tenant.timezone;
  const sp = await searchParams;

  const [employees, stats, departments, roles, managers] = await Promise.all([
    listEmployees(user.tenant_id, {
      q: sp.q,
      departmentId: sp.department,
      status: sp.status,
      roleKey: sp.role,
    }),
    employeeStats(user.tenant_id),
    listDepartments(user.tenant_id),
    listRoles(user.tenant_id),
    pickableUsers(user.tenant_id),
  ]);

  const canCreate = hasPermission(user, "employees", "create");
  const canEdit = hasPermission(user, "employees", "edit");

  return (
    <>
      <PageHeader
        title="Employee directory"
        description="Everyone in the company, their position, reporting line and access role."
      >
        {canCreate && (
          <Link href="/employees/new" className="btn btn-primary">
            <UserPlus size={15} />
            Add employee
          </Link>
        )}
      </PageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total headcount" value={stats.totals.total} icon={<Users size={16} />} />
        <KpiCard label="Active" value={stats.totals.active} tone="success" />
        <KpiCard label="Invited" value={stats.totals.invited} tone="info" />
        <KpiCard
          label="Suspended or left"
          value={stats.totals.inactive}
          tone={stats.totals.inactive > 0 ? "warning" : "default"}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px] mt-4 items-start">
        <Card bodyClassName="p-0">
          <FilterBar
            filters={[
              { name: "q", label: "Search", type: "search", value: sp.q, placeholder: "Name, email, code…" },
              {
                name: "department",
                label: "Department",
                type: "select",
                value: sp.department,
                options: departments.map((d) => ({ value: d.id, label: d.name })),
              },
              {
                name: "role",
                label: "Role",
                type: "select",
                value: sp.role,
                options: roles.map((r) => ({ value: r.key, label: r.role_name })),
              },
              {
                name: "status",
                label: "Status",
                type: "select",
                value: sp.status,
                options: ["active", "invited", "suspended", "left"].map((s) => ({
                  value: s,
                  label: s[0].toUpperCase() + s.slice(1),
                })),
              },
            ]}
          />

          {employees.length === 0 ? (
            <EmptyState
              icon={<Users size={20} />}
              title="No employees match"
              description="Adjust the filters, or add the first employee to the directory."
              action={
                canCreate ? (
                  <Link href="/employees/new" className="btn btn-primary">
                    <UserPlus size={15} />
                    Add employee
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Position</th>
                    <th>Department</th>
                    <th>Reports to</th>
                    <th>Role</th>
                    <th>Joined</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link href={`/employees/${e.id}`} className="flex items-center gap-2.5 group">
                          <Avatar name={e.full_name} url={e.avatar_url} />
                          <span className="min-w-0">
                            <span className="block font-medium group-hover:text-primary transition-colors truncate">
                              {e.full_name}
                            </span>
                            <span className="block text-xs text-fg-subtle truncate">
                              {e.employee_code ?? e.email}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="text-fg-muted">{e.designation ?? "—"}</td>
                      <td className="text-fg-muted">{e.department_name ?? "—"}</td>
                      <td className="text-fg-muted">{e.line_manager_name ?? "—"}</td>
                      <td>
                        {e.role_name ? (
                          <span className="badge badge-primary">{e.role_name}</span>
                        ) : (
                          <span className="text-fg-subtle">No role</span>
                        )}
                      </td>
                      <td className="text-fg-muted">{formatDate(e.date_of_joining, tz)}</td>
                      <td>
                        <StatusBadge status={e.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="grid gap-4">
          <Card title="Headcount by department">
            <RowBars data={stats.byDepartment} />
          </Card>

          <Card title="Departments" bodyClassName="p-0">
            {departments.length === 0 ? (
              <p className="px-5 py-4 text-sm text-fg-subtle">No departments yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {departments.map((d) => (
                  <li key={d.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{d.name}</p>
                      <p className="text-xs text-fg-subtle truncate">
                        {d.head_name ? `Head: ${d.head_name}` : "No head assigned"}
                      </p>
                    </div>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="badge badge-neutral">{d.headcount}</span>
                      {canEdit && (
                        <>
                          <EditDialog
                            title={`Edit ${d.name}`}
                            action={updateDepartmentAction}
                            hidden={{ departmentId: d.id }}
                            fields={[
                              { name: "name", label: "Name", required: true, defaultValue: d.name },
                              { name: "code", label: "Code", defaultValue: d.code ?? "" },
                              {
                                name: "headUserId",
                                label: "Department head",
                                type: "select",
                                defaultValue: d.head_user_id ?? "",
                                options: [
                                  { value: "", label: "Nobody" },
                                  ...managers.map((m) => ({ value: m.id, label: m.full_name })),
                                ],
                              },
                            ]}
                          />
                          <ActionButton
                            action={deleteDepartmentAction}
                            values={{ id: d.id }}
                            label=""
                            title={`Delete ${d.name}`}
                            className="btn-ghost btn-icon"
                            icon={<Trash2 size={14} />}
                            confirm={`Delete the ${d.name} department? This only works while nothing is filed under it.`}
                          />
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {canCreate && (
              <div className="p-5 border-t border-border">
                <p className="text-[0.8125rem] font-semibold mb-3 flex items-center gap-1.5">
                  <Plus size={14} />
                  New department
                </p>
                <AutoForm
                  action={createDepartmentAction}
                  columns={1}
                  compact
                  resetOnSuccess
                  submitLabel="Create department"
                  fields={[
                    { name: "name", label: "Name", required: true, placeholder: "e.g. Logistics" },
                    { name: "code", label: "Code", placeholder: "LOG" },
                    {
                      name: "headUserId",
                      label: "Department head",
                      type: "select",
                      options: managers.map((m) => ({ value: m.id, label: m.full_name })),
                    },
                  ]}
                />
              </div>
            )}
          </Card>

          {hasPermission(user, "employees", "create") && (
            <Card title="Import from a spreadsheet">
              <CsvImport
                action={importEmployeesAction}
                templateHref="/api/templates/employees"
                templateLabel="Download employee template"
                submitLabel="Import employees"
                note={
                  <>
                    Up to 200 rows at a time. Only <strong>full_name</strong> and{" "}
                    <strong>email</strong> are required — an employee code is generated
                    when the column is blank. Department, role and shift are matched by
                    name, and a line manager by email, so a manager listed further down
                    the same file still resolves.
                  </>
                }
              >
                <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    name="createMissing"
                    className="mt-0.5 size-4 rounded border-border accent-primary"
                  />
                  <span>
                    Create departments that do not exist yet
                    <span className="block text-xs text-fg-subtle">
                      Off by default, so a misspelt department is reported rather than
                      quietly created alongside the real one.
                    </span>
                  </span>
                </label>
              </CsvImport>
            </Card>
          )}

          <Card title="Access roles" bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {roles.map((r) => (
                <li key={r.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                  <span className="text-sm truncate">{r.role_name}</span>
                  <span className="badge badge-neutral shrink-0">{r.user_count}</span>
                </li>
              ))}
            </ul>
            <div className="px-5 py-3 border-t border-border">
              <Link href="/users" className="btn btn-ghost btn-sm">
                <Building2 size={14} />
                Manage roles & permissions
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
