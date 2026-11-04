"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword, requireUser, verifyPassword } from "@/lib/auth";
import { requireCompanyAdmin, requirePermission, isCompanyAdmin } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { audit, notify } from "@/lib/audit";
import { nextDocNumber } from "@/lib/sequence";
import type { ActionState } from "@/lib/types";
import { MODULES, PERM_ACTIONS, type Module, type PermAction } from "@/lib/modules";

const optionalUuid = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || /^[0-9a-f-]{36}$/i.test(v), "Invalid selection");

const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

const moneyField = z.coerce.number().min(0).max(1_000_000_000).default(0);

const employeeSchema = z.object({
  fullName: z.string().trim().min(2, "Name is required").max(120),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  phone: optionalText(32),
  designation: optionalText(120),
  employeeCode: optionalText(32),
  departmentId: optionalUuid,
  lineManagerId: optionalUuid,
  roleId: optionalUuid,
  dateOfJoining: optionalDate,
  dateOfBirth: optionalDate,
  gender: optionalText(20),
  bloodGroup: optionalText(8),
  nationalId: optionalText(40),
  maritalStatus: optionalText(20),
  presentAddress: optionalText(400),
  permanentAddress: optionalText(400),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: optionalText(32),
  employmentType: z.enum(["permanent", "contract", "probation", "intern", "consultant"]),
  basicSalary: moneyField,
  houseRent: moneyField,
  medicalAllowance: moneyField,
  transportAllowance: moneyField,
  otherAllowance: moneyField,
  bankName: optionalText(120),
  bankAccount: optionalText(60),
  taxId: optionalText(40),
  probationEndDate: optionalDate,
  contractEndDate: optionalDate,
});

function read(formData: FormData) {
  const get = (k: string) => (formData.get(k) ?? "") as string;
  return {
    fullName: get("fullName"),
    email: get("email"),
    phone: get("phone"),
    designation: get("designation"),
    employeeCode: get("employeeCode"),
    departmentId: get("departmentId"),
    lineManagerId: get("lineManagerId"),
    roleId: get("roleId"),
    dateOfJoining: get("dateOfJoining"),
    dateOfBirth: get("dateOfBirth"),
    gender: get("gender"),
    bloodGroup: get("bloodGroup"),
    nationalId: get("nationalId"),
    maritalStatus: get("maritalStatus"),
    presentAddress: get("presentAddress"),
    permanentAddress: get("permanentAddress"),
    emergencyContactName: get("emergencyContactName"),
    emergencyContactPhone: get("emergencyContactPhone"),
    employmentType: get("employmentType") || "permanent",
    basicSalary: get("basicSalary") || 0,
    houseRent: get("houseRent") || 0,
    medicalAllowance: get("medicalAllowance") || 0,
    transportAllowance: get("transportAllowance") || 0,
    otherAllowance: get("otherAllowance") || 0,
    bankName: get("bankName"),
    bankAccount: get("bankAccount"),
    taxId: get("taxId"),
    probationEndDate: get("probationEndDate"),
    contractEndDate: get("contractEndDate"),
  };
}

/**
 * Creates an employee account. The temporary password is generated here and
 * returned to the creating administrator once — never stored in plain text,
 * never emailed from the server (no mail provider is wired), and never logged.
 */
export async function createEmployeeAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("employees", "create");
  const parsed = employeeSchema.safeParse(read(formData));
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const clash = await db`
    SELECT 1 FROM users WHERE LOWER(email) = LOWER(${d.email})
    -- tenancy-ok: email is globally unique across the platform
  `;
  if (clash.length > 0) {
    return { fieldErrors: { email: ["That email already has an account."] } };
  }

  // Only a company admin may decide what role someone gets. Anyone else with
  // employees.create makes an account on the lowest-privilege role, so the
  // directory permission can never be used to mint an administrator.
  let roleId = d.roleId;
  if (!isCompanyAdmin(user)) {
    const fallback = await db`
      SELECT id FROM roles WHERE tenant_id = ${user.tenant_id} AND key = 'employee'
    `;
    roleId = (fallback[0] as { id: string } | undefined)?.id ?? null;
  } else if (roleId) {
    const owned = await db`
      SELECT 1 FROM roles WHERE id = ${roleId} AND tenant_id = ${user.tenant_id}
    `;
    if (owned.length === 0) return { error: "That role does not belong to your company." };
  }

  for (const [field, value] of [
    ["departmentId", d.departmentId],
    ["lineManagerId", d.lineManagerId],
  ] as const) {
    if (!value) continue;
    const table = field === "departmentId" ? "departments" : "users";
    const rows =
      table === "departments"
        ? await db`SELECT 1 FROM departments WHERE id = ${value} AND tenant_id = ${user.tenant_id}`
        : await db`SELECT 1 FROM users WHERE id = ${value} AND tenant_id = ${user.tenant_id}`;
    if (rows.length === 0) return { error: "Invalid department or line manager." };
  }

  const tempPassword = `Oms-${Math.random().toString(36).slice(2, 8)}${Math.floor(
    Math.random() * 90 + 10
  )}`;
  const code = d.employeeCode ?? (await nextDocNumber(user.tenant_id, "asset", "EMP"));

  const inserted = await db`
    INSERT INTO users (tenant_id, role_id, department_id, line_manager_id, full_name,
                       email, phone, password_hash, employee_code, designation, status)
    VALUES (${user.tenant_id}, ${roleId}, ${d.departmentId}, ${d.lineManagerId},
            ${d.fullName}, ${d.email}, ${d.phone}, ${hashPassword(tempPassword)},
            ${code}, ${d.designation}, 'active')
    RETURNING id
  `;
  const newId = (inserted[0] as { id: string }).id;

  await db`
    INSERT INTO employee_profiles
      (user_id, tenant_id, date_of_joining, date_of_birth, gender, blood_group,
       national_id, marital_status, present_address, permanent_address,
       emergency_contact_name, emergency_contact_phone, employment_type,
       basic_salary, house_rent, medical_allowance, transport_allowance,
       other_allowance, bank_name, bank_account, tax_id,
       probation_end_date, contract_end_date)
    VALUES (${newId}, ${user.tenant_id}, ${d.dateOfJoining}, ${d.dateOfBirth},
            ${d.gender}, ${d.bloodGroup}, ${d.nationalId}, ${d.maritalStatus},
            ${d.presentAddress}, ${d.permanentAddress}, ${d.emergencyContactName},
            ${d.emergencyContactPhone}, ${d.employmentType}, ${d.basicSalary},
            ${d.houseRent}, ${d.medicalAllowance}, ${d.transportAllowance},
            ${d.otherAllowance}, ${d.bankName}, ${d.bankAccount}, ${d.taxId},
            ${d.probationEndDate}, ${d.contractEndDate})
  `;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "employee.created",
    entity: "user",
    entityId: newId,
    summary: `Added employee ${d.fullName}`,
  });

  revalidatePath("/employees");
  return {
    success: `${d.fullName} added. Temporary password: ${tempPassword} — give it to them directly and ask them to change it. It is not shown again.`,
  };
}

export async function updateEmployeeAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("employees", "edit");
  const targetId = String(formData.get("id") ?? "");
  const parsed = employeeSchema.safeParse(read(formData));
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const existing = await db`
    SELECT id, role_id FROM users WHERE id = ${targetId} AND tenant_id = ${user.tenant_id}
  `;
  const current = existing[0] as { id: string; role_id: string | null } | undefined;
  if (!current) return { error: "Employee not found." };

  // Role changes stay with the company admin even here.
  const roleId = isCompanyAdmin(user) ? d.roleId : current.role_id;

  await db`
    UPDATE users
       SET full_name = ${d.fullName}, email = ${d.email}, phone = ${d.phone},
           designation = ${d.designation}, employee_code = ${d.employeeCode},
           department_id = ${d.departmentId}, line_manager_id = ${d.lineManagerId},
           role_id = ${roleId}, updated_at = now()
     WHERE id = ${targetId} AND tenant_id = ${user.tenant_id}
  `;

  await db`
    INSERT INTO employee_profiles
      (user_id, tenant_id, date_of_joining, date_of_birth, gender, blood_group,
       national_id, marital_status, present_address, permanent_address,
       emergency_contact_name, emergency_contact_phone, employment_type,
       basic_salary, house_rent, medical_allowance, transport_allowance,
       other_allowance, bank_name, bank_account, tax_id,
       probation_end_date, contract_end_date, updated_at)
    VALUES (${targetId}, ${user.tenant_id}, ${d.dateOfJoining}, ${d.dateOfBirth},
            ${d.gender}, ${d.bloodGroup}, ${d.nationalId}, ${d.maritalStatus},
            ${d.presentAddress}, ${d.permanentAddress}, ${d.emergencyContactName},
            ${d.emergencyContactPhone}, ${d.employmentType}, ${d.basicSalary},
            ${d.houseRent}, ${d.medicalAllowance}, ${d.transportAllowance},
            ${d.otherAllowance}, ${d.bankName}, ${d.bankAccount}, ${d.taxId},
            ${d.probationEndDate}, ${d.contractEndDate}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      date_of_joining = EXCLUDED.date_of_joining,
      date_of_birth = EXCLUDED.date_of_birth,
      gender = EXCLUDED.gender,
      blood_group = EXCLUDED.blood_group,
      national_id = EXCLUDED.national_id,
      marital_status = EXCLUDED.marital_status,
      present_address = EXCLUDED.present_address,
      permanent_address = EXCLUDED.permanent_address,
      emergency_contact_name = EXCLUDED.emergency_contact_name,
      emergency_contact_phone = EXCLUDED.emergency_contact_phone,
      employment_type = EXCLUDED.employment_type,
      basic_salary = EXCLUDED.basic_salary,
      house_rent = EXCLUDED.house_rent,
      medical_allowance = EXCLUDED.medical_allowance,
      transport_allowance = EXCLUDED.transport_allowance,
      other_allowance = EXCLUDED.other_allowance,
      bank_name = EXCLUDED.bank_name,
      bank_account = EXCLUDED.bank_account,
      tax_id = EXCLUDED.tax_id,
      probation_end_date = EXCLUDED.probation_end_date,
      contract_end_date = EXCLUDED.contract_end_date,
      updated_at = now()
  `;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "employee.updated",
    entity: "user",
    entityId: targetId,
    summary: `Updated employee ${d.fullName}`,
  });

  revalidatePath("/employees");
  revalidatePath(`/employees/${targetId}`);
  redirect(`/employees/${targetId}`);
}

const departmentSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  code: optionalText(20),
  headUserId: optionalUuid,
});

export async function createDepartmentAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("employees", "create");
  const parsed = departmentSchema.safeParse({
    name: formData.get("name") ?? "",
    code: formData.get("code") ?? "",
    headUserId: formData.get("headUserId") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const db = await getDb();
  const d = parsed.data;

  if (d.headUserId) {
    const owned = await db`
      SELECT 1 FROM users WHERE id = ${d.headUserId} AND tenant_id = ${user.tenant_id}
    `;
    if (owned.length === 0) return { error: "Invalid department head." };
  }

  const exists = await db`
    SELECT 1 FROM departments WHERE tenant_id = ${user.tenant_id} AND name = ${d.name}
  `;
  if (exists.length > 0) {
    return { fieldErrors: { name: ["A department with that name already exists."] } };
  }

  await db`
    INSERT INTO departments (tenant_id, name, code, head_user_id)
    VALUES (${user.tenant_id}, ${d.name}, ${d.code}, ${d.headUserId})
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "department.created",
    entity: "department",
    summary: `Created department ${d.name}`,
  });
  revalidatePath("/employees");
  return { success: `Department "${d.name}" created.` };
}

/* --- access control: company admin only ---------------------------------- */

const statusSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(["active", "invited", "suspended", "left"]),
});

export async function setUserStatusAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireCompanyAdmin();
  const parsed = statusSchema.safeParse({
    userId: formData.get("userId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: "Invalid request." };
  const { userId, status } = parsed.data;

  if (userId === user.id) {
    return { error: "You cannot change your own account status." };
  }

  const db = await getDb();
  const updated = await db`
    UPDATE users SET status = ${status}, updated_at = now()
     WHERE id = ${userId} AND tenant_id = ${user.tenant_id}
    RETURNING full_name
  `;
  if (updated.length === 0) return { error: "User not found." };

  // Revoke live sessions immediately when access is withdrawn, rather than
  // waiting for the cookie to expire.
  if (status !== "active") {
    await db`DELETE FROM sessions WHERE user_id = ${userId} AND tenant_id = ${user.tenant_id}`;
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "user.status_changed",
    entity: "user",
    entityId: userId,
    summary: `Set ${(updated[0] as { full_name: string }).full_name} to ${status}`,
  });
  revalidatePath("/users");
  return { success: "Account status updated." };
}

const assignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
});

export async function assignRoleAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireCompanyAdmin();
  const parsed = assignRoleSchema.safeParse({
    userId: formData.get("userId"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) return { error: "Invalid request." };
  const db = await getDb();

  const role = await db`
    SELECT role_name FROM roles
     WHERE id = ${parsed.data.roleId} AND tenant_id = ${user.tenant_id}
  `;
  if (role.length === 0) return { error: "That role does not belong to your company." };

  // Guard against the company locking itself out of its own administration.
  if (parsed.data.userId === user.id) {
    return { error: "You cannot change your own role. Ask another company admin." };
  }

  const updated = await db`
    UPDATE users SET role_id = ${parsed.data.roleId}, updated_at = now()
     WHERE id = ${parsed.data.userId} AND tenant_id = ${user.tenant_id}
    RETURNING full_name
  `;
  if (updated.length === 0) return { error: "User not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "user.role_assigned",
    entity: "user",
    entityId: parsed.data.userId,
    summary: `${(updated[0] as { full_name: string }).full_name} is now ${
      (role[0] as { role_name: string }).role_name
    }`,
  });
  await notify({
    tenantId: user.tenant_id,
    userId: parsed.data.userId,
    title: "Your role changed",
    body: `You are now ${(role[0] as { role_name: string }).role_name}.`,
    link: "/dashboard",
  });
  revalidatePath("/users");
  return { success: "Role assigned." };
}

/**
 * Saves a role's permission matrix. The form posts one checkbox per
 * module/action pair named `perm:<module>:<action>`; anything absent is denied,
 * so unchecking genuinely removes access rather than leaving a stale `true`.
 */
export async function updateRoleMatrixAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireCompanyAdmin();
  const roleId = String(formData.get("roleId") ?? "");
  const db = await getDb();

  const role = await db`
    SELECT key, role_name FROM roles WHERE id = ${roleId} AND tenant_id = ${user.tenant_id}
  `;
  const found = role[0] as { key: string; role_name: string } | undefined;
  if (!found) return { error: "Role not found." };

  // company_admin is full access by definition (see permissions.ts); editing
  // its matrix would be misleading, since the code bypasses it anyway.
  if (found.key === "company_admin") {
    return { error: "The Company Admin role always has full access and cannot be limited." };
  }

  const matrix: Record<string, Record<string, boolean>> = {};
  for (const m of MODULES as readonly Module[]) {
    const row: Record<string, boolean> = {};
    let any = false;
    for (const a of PERM_ACTIONS as readonly PermAction[]) {
      if (formData.get(`perm:${m}:${a}`) === "on") {
        row[a] = true;
        any = true;
      }
    }
    if (any) matrix[m] = row;
  }

  await db`
    UPDATE roles SET permissions_matrix = ${JSON.stringify(matrix)}::jsonb
     WHERE id = ${roleId} AND tenant_id = ${user.tenant_id}
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "role.matrix_updated",
    entity: "role",
    entityId: roleId,
    summary: `Updated permissions for ${found.role_name}`,
  });
  revalidatePath("/users");
  return { success: `Permissions saved for ${found.role_name}.` };
}

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z
      .string()
      .min(8, "Use at least 8 characters")
      .regex(/[a-z]/, "Include a lower-case letter")
      .regex(/[A-Z]/, "Include an upper-case letter")
      .regex(/[0-9]/, "Include a number"),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

/** Self-service password change. */
export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse({
    current: formData.get("current"),
    next: formData.get("next"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const db = await getDb();
  const rows = await db`
    SELECT password_hash FROM users WHERE id = ${user.id} AND tenant_id = ${user.tenant_id}
  `;
  const row = rows[0] as { password_hash: string } | undefined;
  if (!row || !verifyPassword(row, parsed.data.current)) {
    return { fieldErrors: { current: ["That is not your current password."] } };
  }

  await db`
    UPDATE users SET password_hash = ${hashPassword(parsed.data.next)}, updated_at = now()
     WHERE id = ${user.id} AND tenant_id = ${user.tenant_id}
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "user.password_changed",
    summary: "Password changed",
  });
  return { success: "Password updated." };
}
