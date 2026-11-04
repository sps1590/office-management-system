import type { Metadata } from "next";
import { isCompanyAdmin, requirePermission } from "@/lib/permissions";
import { listDepartments, listRoles, pickableUsers } from "@/lib/employees";
import EmployeeForm from "@/components/forms/EmployeeForm";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const user = await requirePermission("employees", "create");
  const [departments, roles, managers] = await Promise.all([
    listDepartments(user.tenant_id),
    listRoles(user.tenant_id),
    pickableUsers(user.tenant_id),
  ]);

  return (
    <>
      <PageHeader
        title="Add employee"
        description="Creates the person's directory record and their sign-in account."
      />
      <EmployeeForm
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        managers={managers.map((m) => ({
          id: m.id,
          name: m.designation ? `${m.full_name} — ${m.designation}` : m.full_name,
        }))}
        roles={roles.map((r) => ({ id: r.id, name: r.role_name }))}
        canAssignRole={isCompanyAdmin(user)}
        currency={user.tenant.currency}
      />
    </>
  );
}
