import "server-only";
import { getDb } from "./db";

export type EmployeeListRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  employee_code: string | null;
  designation: string | null;
  status: string;
  avatar_url: string | null;
  role_name: string | null;
  role_key: string | null;
  department_id: string | null;
  department_name: string | null;
  line_manager_name: string | null;
  date_of_joining: string | null;
};

export type EmployeeDetail = EmployeeListRow & {
  tenant_id: string;
  role_id: string | null;
  line_manager_id: string | null;
  date_of_birth: string | null;
  gender: string | null;
  blood_group: string | null;
  national_id: string | null;
  marital_status: string | null;
  present_address: string | null;
  permanent_address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  employment_type: string | null;
  basic_salary: number;
  house_rent: number;
  medical_allowance: number;
  transport_allowance: number;
  other_allowance: number;
  bank_name: string | null;
  bank_account: string | null;
  tax_id: string | null;
  probation_end_date: string | null;
  contract_end_date: string | null;
  last_login_at: string | null;
};

/** Directory list with optional search and filters, newest joiners first. */
export async function listEmployees(
  tenantId: string,
  filters: { q?: string; departmentId?: string; status?: string; roleKey?: string } = {}
): Promise<EmployeeListRow[]> {
  const db = await getDb();
  const q = filters.q?.trim() ? `%${filters.q.trim()}%` : null;
  const rows = await db`
    SELECT u.id, u.full_name, u.email, u.phone, u.employee_code, u.designation,
           u.status, u.avatar_url, u.department_id,
           r.role_name, r.key AS role_key,
           d.name AS department_name,
           m.full_name AS line_manager_name,
           p.date_of_joining
      FROM users u
      LEFT JOIN roles r             ON r.id = u.role_id
      LEFT JOIN departments d       ON d.id = u.department_id
      LEFT JOIN users m             ON m.id = u.line_manager_id
      LEFT JOIN employee_profiles p ON p.user_id = u.id
     WHERE u.tenant_id = ${tenantId}
       AND (${q}::text IS NULL OR u.full_name ILIKE ${q} OR u.email ILIKE ${q}
            OR u.employee_code ILIKE ${q} OR u.designation ILIKE ${q})
       AND (${filters.departmentId ?? null}::uuid IS NULL OR u.department_id = ${filters.departmentId ?? null}::uuid)
       AND (${filters.status ?? null}::text IS NULL OR u.status = ${filters.status ?? null})
       AND (${filters.roleKey ?? null}::text IS NULL OR r.key = ${filters.roleKey ?? null})
     ORDER BY u.status = 'active' DESC, u.full_name
  `;
  return rows as unknown as EmployeeListRow[];
}

export async function getEmployee(
  tenantId: string,
  userId: string
): Promise<EmployeeDetail | null> {
  const db = await getDb();
  const rows = await db`
    SELECT u.id, u.tenant_id, u.full_name, u.email, u.phone, u.employee_code,
           u.designation, u.status, u.avatar_url, u.role_id, u.department_id,
           u.line_manager_id, u.last_login_at,
           r.role_name, r.key AS role_key,
           d.name AS department_name,
           m.full_name AS line_manager_name,
           p.date_of_joining, p.date_of_birth, p.gender, p.blood_group,
           p.national_id, p.marital_status, p.present_address, p.permanent_address,
           p.emergency_contact_name, p.emergency_contact_phone, p.employment_type,
           COALESCE(p.basic_salary, 0)::float        AS basic_salary,
           COALESCE(p.house_rent, 0)::float          AS house_rent,
           COALESCE(p.medical_allowance, 0)::float   AS medical_allowance,
           COALESCE(p.transport_allowance, 0)::float AS transport_allowance,
           COALESCE(p.other_allowance, 0)::float     AS other_allowance,
           p.bank_name, p.bank_account, p.tax_id,
           p.probation_end_date, p.contract_end_date
      FROM users u
      LEFT JOIN roles r             ON r.id = u.role_id
      LEFT JOIN departments d       ON d.id = u.department_id
      LEFT JOIN users m             ON m.id = u.line_manager_id
      LEFT JOIN employee_profiles p ON p.user_id = u.id
     WHERE u.tenant_id = ${tenantId} AND u.id = ${userId}
  `;
  return (rows[0] as EmployeeDetail | undefined) ?? null;
}

/** Headcount by department and by employment type, for the directory header. */
export async function employeeStats(tenantId: string) {
  const db = await getDb();
  const [totals, byDept] = await Promise.all([
    db`
      SELECT COUNT(*)::int                                        AS total,
             COUNT(*) FILTER (WHERE status = 'active')::int        AS active,
             COUNT(*) FILTER (WHERE status = 'invited')::int       AS invited,
             COUNT(*) FILTER (WHERE status IN ('suspended','left'))::int AS inactive
        FROM users WHERE tenant_id = ${tenantId}
    `,
    db`
      SELECT COALESCE(d.name, 'Unassigned') AS label, COUNT(u.id)::int AS value
        FROM users u
        LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.tenant_id = ${tenantId} AND u.status = 'active'
       GROUP BY d.name
       ORDER BY value DESC
       LIMIT 8
    `,
  ]);
  return {
    totals: totals[0] as { total: number; active: number; invited: number; inactive: number },
    byDepartment: byDept as unknown as { label: string; value: number }[],
  };
}

export async function listDepartments(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT d.id, d.name, d.code, d.head_user_id,
           h.full_name AS head_name,
           (SELECT COUNT(*)::int FROM users u
             WHERE u.department_id = d.id AND u.tenant_id = ${tenantId}
               AND u.status = 'active') AS headcount
      FROM departments d
      LEFT JOIN users h ON h.id = d.head_user_id
     WHERE d.tenant_id = ${tenantId}
     ORDER BY d.name
  `;
  return rows as unknown as {
    id: string;
    name: string;
    code: string | null;
    head_user_id: string | null;
    head_name: string | null;
    headcount: number;
  }[];
}

/** Roles available in this tenant, for the assignment dropdown. */
export async function listRoles(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT id, key, role_name, description, permissions_matrix, is_system, sort_order,
           (SELECT COUNT(*)::int FROM users u WHERE u.role_id = roles.id
             AND u.tenant_id = ${tenantId}) AS user_count
      FROM roles
     WHERE tenant_id = ${tenantId}
     ORDER BY sort_order, role_name
  `;
  return rows as unknown as {
    id: string;
    key: string;
    role_name: string;
    description: string | null;
    permissions_matrix: Record<string, Record<string, boolean>>;
    is_system: boolean;
    sort_order: number;
    user_count: number;
  }[];
}

/** Minimal id/name pairs for assignee and manager pickers. */
export async function pickableUsers(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT u.id, u.full_name, u.designation, r.key AS role_key
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.tenant_id = ${tenantId} AND u.status = 'active'
     ORDER BY u.full_name
  `;
  return rows as unknown as {
    id: string;
    full_name: string;
    designation: string | null;
    role_key: string | null;
  }[];
}
