"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { generateTempPassword, hashPassword } from "@/lib/auth";
import { isCompanyAdmin, requirePermission } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { parseCsv, rowsToObjects } from "@/lib/csv";
import { nextDocNumbers } from "@/lib/sequence";
import { isoDate } from "@/lib/utils";
import type { ImportState } from "@/lib/types";

/**
 * Spreadsheet imports: the employee directory, and the annual leave allotment.
 *
 * Both follow the same shape — download a template that already knows the
 * company's departments, roles and leave categories, fill it in Excel, upload
 * it back. Both validate every row, write the good ones and report the rest
 * by the line number the spreadsheet shows, because an all-or-nothing import
 * makes somebody bisect their own file to find the one bad cell.
 *
 * Neither is a queue or a job. A file is parsed, validated and written inside
 * the one request, which is why MAX_ROWS exists: each new account costs a
 * bcrypt hash at cost 10, roughly 60-130ms, and a function has sixty seconds.
 */

/** Above this, the hashing alone would outlast the function. */
const MAX_ROWS = 200;
const MAX_BYTES = 2 * 1024 * 1024;

/** Reads the uploaded file, or says why it cannot. */
async function readUpload(formData: FormData): Promise<{ rows: Record<string, string>[] } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to upload." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "That file is larger than 2 MB. Split it and import in parts." };
  }
  const text = await file.text();
  const rows = rowsToObjects(parseCsv(text));
  if (rows.length === 0) {
    return { error: "That file has a header row but no data rows." };
  }
  if (rows.length > MAX_ROWS) {
    return {
      error: `That file has ${rows.length} rows. Import at most ${MAX_ROWS} at a time, so the upload finishes inside one request.`,
    };
  }
  return { rows };
}

/** The spreadsheet's own line number for data row `i`, header included. */
const lineNo = (i: number) => i + 2;

/* --- employees ------------------------------------------------------------ */

const EMPLOYMENT_TYPES = ["permanent", "contract", "probation", "intern", "consultant"] as const;

const importedEmployee = z.object({
  fullname: z.string().trim().min(2, "Full name is required").max(120),
  email: z.string().trim().toLowerCase().email("Not a valid email address"),
  employeecode: z.string().trim().max(32).optional(),
  designation: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  role: z.string().trim().max(120).optional(),
  shift: z.string().trim().max(120).optional(),
  linemanageremail: z.string().trim().toLowerCase().optional(),
  phone: z.string().trim().max(32).optional(),
  dateofjoining: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Joining date must be YYYY-MM-DD")
    .optional()
    .or(z.literal("")),
  employmenttype: z
    .enum(EMPLOYMENT_TYPES, `Employment type must be one of: ${EMPLOYMENT_TYPES.join(", ")}`)
    .optional()
    .or(z.literal("")),
  basicsalary: z.string().trim().optional(),
  houserent: z.string().trim().optional(),
  medicalallowance: z.string().trim().optional(),
  transportallowance: z.string().trim().optional(),
  otherallowance: z.string().trim().optional(),
  gender: z.string().trim().max(20).optional(),
  nationalid: z.string().trim().max(40).optional(),
  presentaddress: z.string().trim().max(400).optional(),
  emergencycontactname: z.string().trim().max(120).optional(),
  emergencycontactphone: z.string().trim().max(32).optional(),
});

/** A money cell: blank is zero, and "1,200" or "৳1200" is 1200. */
function moneyCell(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function importEmployeesAction(
  _prev: ImportState,
  formData: FormData
): Promise<ImportState> {
  const user = await requirePermission("employees", "create");
  const upload = await readUpload(formData);
  if ("error" in upload) return { error: upload.error };
  const { rows } = upload;
  const createMissing = formData.get("createMissing") === "on";

  const db = await getDb();
  const problems: { row: number; message: string }[] = [];

  // Everything the rows might refer to, fetched once. Resolving a department
  // per row would be two hundred round trips to Singapore.
  const [deptRows, roleRows, shiftRows, existingRows] = await Promise.all([
    db`SELECT id, name FROM departments WHERE tenant_id = ${user.tenant_id}`,
    db`SELECT id, role_name, key FROM roles WHERE tenant_id = ${user.tenant_id}`,
    db`SELECT id, name FROM shifts WHERE tenant_id = ${user.tenant_id}`,
    db`SELECT id, LOWER(email) AS email FROM users WHERE tenant_id = ${user.tenant_id}`,
  ]);

  const key = (s: string) => s.trim().toLowerCase();
  const departments = new Map(
    (deptRows as unknown as { id: string; name: string }[]).map((d) => [key(d.name), d.id])
  );
  const roles = new Map(
    (roleRows as unknown as { id: string; role_name: string; key: string }[]).flatMap((r) => [
      // Matched by either the display name ("HR Manager / HR Admin") or the
      // stable key ("hr_manager"), because a spreadsheet will carry both.
      [key(r.role_name), r.id] as const,
      [key(r.key), r.id] as const,
    ])
  );
  const shifts = new Map(
    (shiftRows as unknown as { id: string; name: string }[]).map((s) => [key(s.name), s.id])
  );
  const employeeRoleId = roles.get("employee") ?? null;

  // Email is UNIQUE across the whole platform, so a clash with *another*
  // company's account must be caught too, not just this company's.
  const emails = rows.map((r) => (r.email ?? "").trim().toLowerCase()).filter(Boolean);
  const takenRows = emails.length
    ? await db`
        SELECT LOWER(email) AS email FROM users WHERE LOWER(email) = ANY(${emails})
        -- tenancy-ok: email is globally unique, so a clash in another tenant still blocks
      `
    : [];
  const taken = new Set((takenRows as unknown as { email: string }[]).map((r) => r.email));
  const seenInFile = new Set<string>();

  type Pending = z.infer<typeof importedEmployee> & { _row: number; _password: string };
  const pending: Pending[] = [];
  const newDepartments = new Map<string, string>();

  rows.forEach((raw, i) => {
    const parsed = importedEmployee.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      problems.push({ row: lineNo(i), message: first.message });
      return;
    }
    const d = parsed.data;

    if (taken.has(d.email)) {
      problems.push({ row: lineNo(i), message: `${d.email} already has an account` });
      return;
    }
    if (seenInFile.has(d.email)) {
      problems.push({ row: lineNo(i), message: `${d.email} appears twice in this file` });
      return;
    }
    if (d.department && !departments.has(key(d.department)) && !createMissing) {
      problems.push({
        row: lineNo(i),
        message: `No department called "${d.department}". Tick "create missing departments" or fix the spelling.`,
      });
      return;
    }
    if (d.role && !roles.has(key(d.role))) {
      problems.push({ row: lineNo(i), message: `No role called "${d.role}"` });
      return;
    }
    if (d.shift && !shifts.has(key(d.shift))) {
      problems.push({ row: lineNo(i), message: `No shift called "${d.shift}"` });
      return;
    }
    if (d.department && !departments.has(key(d.department))) {
      newDepartments.set(key(d.department), d.department);
    }
    seenInFile.add(d.email);
    pending.push({ ...d, _row: lineNo(i), _password: generateTempPassword() });
  });

  if (pending.length === 0) {
    return {
      error: "Nothing could be imported.",
      problems,
      created: 0,
    };
  }

  // Departments the file asked for and the administrator agreed to create.
  if (newDepartments.size > 0) {
    const made = await db`
      INSERT INTO departments (tenant_id, name)
      SELECT ${user.tenant_id}, name
        FROM jsonb_to_recordset(${JSON.stringify(
          [...newDepartments.values()].map((name) => ({ name }))
        )}::jsonb) AS t(name TEXT)
      RETURNING id, name
    `;
    for (const d of made as unknown as { id: string; name: string }[]) {
      departments.set(key(d.name), d.id);
    }
  }

  // Only a company admin may decide what role somebody gets; anyone else with
  // employees.create imports everyone onto the lowest-privilege role, exactly
  // as createEmployeeAction does, so the directory permission can never be
  // used to mint an administrator.
  const mayChooseRole = isCompanyAdmin(user);
  const codes = await nextDocNumbers(
    user.tenant_id,
    "employee",
    "EMP",
    pending.filter((p) => !p.employeecode).length
  );
  let nextCode = 0;

  const userRows = pending.map((p) => ({
    tenant_id: user.tenant_id,
    role_id: mayChooseRole && p.role ? roles.get(key(p.role)) : employeeRoleId,
    department_id: p.department ? (departments.get(key(p.department)) ?? null) : null,
    shift_id: p.shift ? (shifts.get(key(p.shift)) ?? null) : null,
    full_name: p.fullname,
    email: p.email,
    phone: p.phone || null,
    password_hash: hashPassword(p._password),
    employee_code: p.employeecode || codes[nextCode++],
    designation: p.designation || null,
  }));

  // jsonb_to_recordset rather than parallel unnest arrays: most of these
  // columns are optional, and a Postgres array literal has to spell every
  // null out while a JSON object just leaves the key off.
  const inserted = await db`
    INSERT INTO users (tenant_id, role_id, department_id, shift_id, full_name,
                       email, phone, password_hash, employee_code, designation, status)
    SELECT tenant_id, role_id, department_id, shift_id, full_name, email, phone,
           password_hash, employee_code, designation, 'active'
      FROM jsonb_to_recordset(${JSON.stringify(userRows)}::jsonb)
        AS t(tenant_id UUID, role_id UUID, department_id UUID, shift_id UUID,
             full_name TEXT, email TEXT, phone TEXT, password_hash TEXT,
             employee_code TEXT, designation TEXT)
    RETURNING id, LOWER(email) AS email
  `;
  const idByEmail = new Map(
    (inserted as unknown as { id: string; email: string }[]).map((r) => [r.email, r.id])
  );

  const profileRows = pending.map((p) => ({
    user_id: idByEmail.get(p.email),
    tenant_id: user.tenant_id,
    date_of_joining: p.dateofjoining || null,
    gender: p.gender || null,
    national_id: p.nationalid || null,
    present_address: p.presentaddress || null,
    emergency_contact_name: p.emergencycontactname || null,
    emergency_contact_phone: p.emergencycontactphone || null,
    employment_type: p.employmenttype || "permanent",
    basic_salary: moneyCell(p.basicsalary),
    house_rent: moneyCell(p.houserent),
    medical_allowance: moneyCell(p.medicalallowance),
    transport_allowance: moneyCell(p.transportallowance),
    other_allowance: moneyCell(p.otherallowance),
  }));

  await db`
    INSERT INTO employee_profiles
      (user_id, tenant_id, date_of_joining, gender, national_id, present_address,
       emergency_contact_name, emergency_contact_phone, employment_type,
       basic_salary, house_rent, medical_allowance, transport_allowance, other_allowance)
    SELECT user_id, tenant_id, date_of_joining, gender, national_id, present_address,
           emergency_contact_name, emergency_contact_phone, employment_type,
           basic_salary, house_rent, medical_allowance, transport_allowance, other_allowance
      FROM jsonb_to_recordset(${JSON.stringify(profileRows)}::jsonb)
        AS t(user_id UUID, tenant_id UUID, date_of_joining DATE, gender TEXT,
             national_id TEXT, present_address TEXT, emergency_contact_name TEXT,
             emergency_contact_phone TEXT, employment_type TEXT,
             basic_salary NUMERIC, house_rent NUMERIC, medical_allowance NUMERIC,
             transport_allowance NUMERIC, other_allowance NUMERIC)
  `;

  /*
     Line managers are resolved in a second pass on purpose: a file that
     onboards a whole department usually names a manager who is in the same
     file, and that person has no id until the insert above has run. Doing it
     here means "manager" can point at somebody three rows further down.
  */
  const managerLinks = pending
    .filter((p) => p.linemanageremail)
    .map((p) => ({ email: p.email, manager: p.linemanageremail as string }));
  if (managerLinks.length > 0) {
    const unresolved = await db`
      UPDATE users u
         SET line_manager_id = m.id
        FROM jsonb_to_recordset(${JSON.stringify(managerLinks)}::jsonb)
               AS t(email TEXT, manager TEXT)
        JOIN users m ON LOWER(m.email) = t.manager AND m.tenant_id = ${user.tenant_id}
       WHERE LOWER(u.email) = t.email AND u.tenant_id = ${user.tenant_id}
      RETURNING LOWER(u.email) AS email
    `;
    const linked = new Set((unresolved as unknown as { email: string }[]).map((r) => r.email));
    for (const p of pending) {
      if (p.linemanageremail && !linked.has(p.email)) {
        problems.push({
          row: p._row,
          message: `Imported, but no colleague has the email "${p.linemanageremail}" — line manager left unset`,
        });
      }
    }
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "employee.import",
    entity: "user",
    summary: `Imported ${pending.length} employee${pending.length === 1 ? "" : "s"} from a spreadsheet`,
  });

  revalidatePath("/employees");
  revalidatePath("/users");

  return {
    created: pending.length,
    problems,
    credentials: pending.map((p) => ({
      name: p.fullname,
      email: p.email,
      password: p._password,
    })),
    summary:
      `Imported ${pending.length} employee${pending.length === 1 ? "" : "s"}` +
      (problems.length > 0 ? `, skipped ${problems.length}.` : "."),
  };
}

/* --- leave allotment ------------------------------------------------------ */

/**
 * Sets each person's annual entitlement per leave category.
 *
 * The template is generated already filled with the company's own people and
 * leave types, so this is an edit-and-return rather than a type-it-out: one
 * row per employee, one column per category. A blank cell means "leave this
 * one alone", which is the difference between skipping a category and
 * setting it to zero — a distinction an importer has to get right, because
 * zero days of annual leave is a real and very different instruction.
 */
export async function importLeaveAllotmentAction(
  _prev: ImportState,
  formData: FormData
): Promise<ImportState> {
  const user = await requirePermission("leave", "edit");
  const upload = await readUpload(formData);
  if ("error" in upload) return { error: upload.error };
  const { rows } = upload;

  const year = Number(formData.get("year")) || Number(isoDate(user.tenant.timezone).slice(0, 4));
  if (year < 2000 || year > 2100) return { error: "Enter a four-digit year." };

  const db = await getDb();
  const [typeRows, staffRows] = await Promise.all([
    db`SELECT id, name FROM leave_types WHERE tenant_id = ${user.tenant_id} AND is_active = TRUE`,
    db`SELECT id, LOWER(email) AS email, employee_code FROM users WHERE tenant_id = ${user.tenant_id}`,
  ]);

  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const typeByColumn = new Map(
    (typeRows as unknown as { id: string; name: string }[]).map((t) => [norm(t.name), t.id])
  );
  const staff = staffRows as unknown as {
    id: string;
    email: string;
    employee_code: string | null;
  }[];
  const byEmail = new Map(staff.map((s) => [s.email, s.id]));
  const byCode = new Map(
    staff.filter((s) => s.employee_code).map((s) => [norm(s.employee_code as string), s.id])
  );

  const problems: { row: number; message: string }[] = [];
  const balances: { user_id: string; leave_type_id: string; entitled: number }[] = [];

  rows.forEach((raw, i) => {
    const email = (raw.email ?? "").toLowerCase();
    const code = raw.employeecode ?? "";
    const userId = byEmail.get(email) ?? (code ? byCode.get(norm(code)) : undefined);
    if (!userId) {
      problems.push({
        row: lineNo(i),
        message: `No employee matches "${email || code || "(blank)"}" — leave the email column as generated`,
      });
      return;
    }

    let touched = 0;
    for (const [column, value] of Object.entries(raw)) {
      const typeId = typeByColumn.get(column);
      // Blank means "do not change this category", not zero.
      if (!typeId || value === "") continue;
      const days = Number(value);
      if (!Number.isFinite(days) || days < 0 || days > 999) {
        problems.push({ row: lineNo(i), message: `"${value}" is not a number of days` });
        continue;
      }
      balances.push({ user_id: userId, leave_type_id: typeId, entitled: days });
      touched++;
    }
    if (touched === 0 && problems.at(-1)?.row !== lineNo(i)) {
      problems.push({ row: lineNo(i), message: "No leave figures on this row — nothing to set" });
    }
  });

  if (balances.length === 0) {
    return { error: "No leave allotments could be read from that file.", problems, updated: 0 };
  }

  /*
     One statement for the whole file. The unique key is
     (tenant, user, type, year), so re-importing a corrected spreadsheet
     overwrites rather than duplicating -- which is what somebody fixing a
     typo expects. `used` is deliberately not touched: it is derived from
     approved requests, and a spreadsheet must not be able to rewrite how
     much leave somebody has already taken.
  */
  await db`
    INSERT INTO leave_balances (tenant_id, user_id, leave_type_id, year, entitled)
    SELECT ${user.tenant_id}, user_id, leave_type_id, ${year}, entitled
      FROM jsonb_to_recordset(${JSON.stringify(balances)}::jsonb)
        AS t(user_id UUID, leave_type_id UUID, entitled NUMERIC)
    ON CONFLICT (tenant_id, user_id, leave_type_id, year)
      DO UPDATE SET entitled = EXCLUDED.entitled
  `;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "leave.allotment_import",
    entity: "leave_balance",
    summary: `Set ${balances.length} leave allotments for ${year} from a spreadsheet`,
  });

  revalidatePath("/leave");
  revalidatePath("/me");

  return {
    updated: balances.length,
    problems,
    summary:
      `Set ${balances.length} allotment${balances.length === 1 ? "" : "s"} for ${year}` +
      (problems.length > 0 ? `, with ${problems.length} problem${problems.length === 1 ? "" : "s"}.` : "."),
  };
}
