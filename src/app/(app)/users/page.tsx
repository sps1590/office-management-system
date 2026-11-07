import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, UserCog } from "lucide-react";
import { requireCompanyAdmin } from "@/lib/permissions";
import { listEmployees, listRoles } from "@/lib/employees";
import {
  assignRoleAction,
  resetUserPasswordAction,
  setUserStatusAction,
} from "@/lib/actions/employees";
import AutoForm from "@/components/forms/AutoForm";
import PermissionMatrix from "@/components/forms/PermissionMatrix";
import { Avatar, Card, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { expandMatrix } from "@/lib/modules";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Users & roles" };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  // Hard-coded to the company admin: letting the permission matrix govern who
  // may edit the permission matrix would be a privilege-escalation path.
  const user = await requireCompanyAdmin();
  const tz = user.tenant.timezone;
  const sp = await searchParams;

  const [users, roles] = await Promise.all([
    listEmployees(user.tenant_id),
    listRoles(user.tenant_id),
  ]);

  const selected = roles.find((r) => r.id === sp.role) ?? roles.find((r) => r.key === "employee") ?? roles[0];

  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Account access and the per-role permission matrix. Only a company admin can open this page."
      >
        <Link href="/employees" className="btn btn-secondary">
          Employee directory
        </Link>
      </PageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Accounts" value={users.length} icon={<UserCog size={16} />} />
        <KpiCard
          label="Active"
          value={users.filter((u) => u.status === "active").length}
          tone="success"
        />
        <KpiCard
          label="Suspended or left"
          value={users.filter((u) => ["suspended", "left"].includes(u.status)).length}
          tone={users.some((u) => ["suspended", "left"].includes(u.status)) ? "warning" : "default"}
        />
        <KpiCard
          label="Roles configured"
          value={roles.length}
          icon={<ShieldCheck size={16} />}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <Card title="Accounts" bodyClassName="p-0">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Last sign-in</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link href={`/employees/${u.id}`} className="flex items-center gap-2.5 group">
                        <Avatar name={u.full_name} url={u.avatar_url} size={28} />
                        <span className="min-w-0">
                          <span className="block font-medium group-hover:text-primary transition-colors truncate">
                            {u.full_name}
                            {u.id === user.id && (
                              <span className="badge badge-neutral ml-2">you</span>
                            )}
                          </span>
                          <span className="block text-xs text-fg-subtle truncate">
                            {u.email}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      {u.role_name ? (
                        <span className="badge badge-primary">{u.role_name}</span>
                      ) : (
                        <span className="text-fg-subtle">No role</span>
                      )}
                    </td>
                    <td className="text-fg-muted">{u.department_name ?? "—"}</td>
                    <td className="text-fg-muted text-xs">
                      {u.last_login_at ? formatDateTime(u.last_login_at, tz) : "Never"}
                    </td>
                    <td>
                      <StatusBadge status={u.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid gap-4">
          <Card title="Assign a role">
            <AutoForm
              action={assignRoleAction}
              columns={1}
              compact
              submitLabel="Assign role"
              fields={[
                {
                  name: "userId",
                  label: "User",
                  type: "select",
                  required: true,
                  options: users
                    .filter((u) => u.id !== user.id)
                    .map((u) => ({
                      value: u.id,
                      label: `${u.full_name}${u.role_name ? ` — ${u.role_name}` : ""}`,
                    })),
                },
                {
                  name: "roleId",
                  label: "Role",
                  type: "select",
                  required: true,
                  options: roles.map((r) => ({ value: r.id, label: r.role_name })),
                },
              ]}
            />
            <p className="help mt-3">
              You cannot change your own role — ask another company admin, so the company
              can never lock itself out.
            </p>
          </Card>

          <Card title="Account status">
            <AutoForm
              action={setUserStatusAction}
              columns={1}
              compact
              submitLabel="Update status"
              fields={[
                {
                  name: "userId",
                  label: "User",
                  type: "select",
                  required: true,
                  options: users
                    .filter((u) => u.id !== user.id)
                    .map((u) => ({ value: u.id, label: u.full_name })),
                },
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  required: true,
                  defaultValue: "active",
                  options: ["active", "invited", "suspended", "left"].map((s) => ({
                    value: s,
                    label: s,
                  })),
                },
              ]}
            />
            <p className="help mt-3">
              Suspending someone also ends their live sessions immediately.
            </p>
          </Card>

          <Card title="Reset a password">
            <AutoForm
              action={resetUserPasswordAction}
              columns={1}
              compact
              submitLabel="Reset password"
              fields={[
                {
                  name: "userId",
                  label: "User",
                  type: "select",
                  required: true,
                  options: users
                    .filter((u) => u.id !== user.id)
                    .map((u) => ({ value: u.id, label: `${u.full_name} — ${u.email}` })),
                },
              ]}
            />
            <p className="help mt-3">
              Shows a temporary password once and signs the person out everywhere. Hand
              it over directly and ask them to change it on their profile. You cannot
              reset your own — ask another company admin, so a borrowed unlocked laptop
              can never take an account over.
            </p>
          </Card>

          <Card title="Roles" bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {roles.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/users?role=${r.id}`}
                    className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-surface-hover transition-colors"
                    data-active={selected?.id === r.id}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">
                        {r.role_name}
                      </span>
                      <span className="block text-xs text-fg-subtle truncate">
                        {r.user_count} user{r.user_count === 1 ? "" : "s"}
                      </span>
                    </span>
                    {selected?.id === r.id && (
                      <span className="badge badge-primary shrink-0">editing</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {selected && (
        <Card title={`Permissions — ${selected.role_name}`} className="mt-4">
          {selected.description && (
            <p className="text-sm text-fg-muted mb-4">{selected.description}</p>
          )}
          <PermissionMatrix
            roleId={selected.id}
            roleName={selected.role_name}
            roleKey={selected.key}
            matrix={expandMatrix(selected.permissions_matrix)}
          />
        </Card>
      )}
    </>
  );
}
