import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isCompanyAdmin, requirePermission } from "@/lib/permissions";
import {
  getEmployee,
  listDepartments,
  listRoles,
  pickableUsers,
} from "@/lib/employees";
import EmployeeForm from "@/components/forms/EmployeeForm";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Edit employee" };

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("employees", "edit");
  const { id } = await params;

  const [employee, departments, roles, managers] = await Promise.all([
    getEmployee(user.tenant_id, id),
    listDepartments(user.tenant_id),
    listRoles(user.tenant_id),
    pickableUsers(user.tenant_id),
  ]);
  if (!employee) notFound();

  return (
    <>
      <PageHeader title={`Edit ${employee.full_name}`} />
      <EmployeeForm
        employee={employee}
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
