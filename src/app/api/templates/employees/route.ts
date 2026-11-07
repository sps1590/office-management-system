import { getSessionUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { toCsv } from "@/lib/csv";

/**
 * The blank employee spreadsheet, as a download.
 *
 * A route handler rather than a Server Action because the browser should get
 * a real file with a real filename, which an action returning a string cannot
 * do without the client assembling a Blob.
 *
 * The single example row is filled from the company's own first department,
 * role and shift, so the file documents its own valid values instead of
 * sending somebody back to the screen to look them up.
 */
export async function GET() {
  const user = await getSessionUser();
  // A route handler cannot redirect a download usefully, so these answer with
  // a status rather than calling requirePermission.
  if (!user) return new Response("Sign in first.", { status: 401 });
  if (!hasPermission(user, "employees", "create")) {
    return new Response("You cannot add employees.", { status: 403 });
  }

  const db = await getDb();
  const [depts, roles, shifts] = await Promise.all([
    db`SELECT name FROM departments WHERE tenant_id = ${user.tenant_id} ORDER BY name LIMIT 1`,
    db`SELECT role_name AS name FROM roles WHERE tenant_id = ${user.tenant_id} AND key = 'employee' LIMIT 1`,
    db`SELECT name FROM shifts WHERE tenant_id = ${user.tenant_id} AND is_active ORDER BY name LIMIT 1`,
  ]);
  const first = (rows: unknown[], fallback: string) =>
    (rows[0] as { name: string } | undefined)?.name ?? fallback;

  const headers = [
    "full_name*",
    "email*",
    "employee_code",
    "designation",
    "department",
    "role",
    "shift",
    "line_manager_email",
    "phone",
    "date_of_joining",
    "employment_type",
    "basic_salary",
    "house_rent",
    "medical_allowance",
    "transport_allowance",
    "other_allowance",
    "gender",
    "national_id",
    "present_address",
    "emergency_contact_name",
    "emergency_contact_phone",
  ];

  const example = [
    "Example Person — delete this row",
    "example@yourcompany.com",
    "",
    "Officer",
    first(depts, "Management"),
    first(roles, "Standard Employee"),
    first(shifts, ""),
    user.email,
    "+8801700000000",
    "2026-01-15",
    "permanent",
    30000,
    12000,
    2000,
    2000,
    0,
    "female",
    "",
    "",
    "",
    "",
  ];

  const csv = toCsv(headers, [example]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="employee-import-template.csv"',
      // Generated per company and per signed-in user; never a shared cache.
      "Cache-Control": "no-store, private",
    },
  });
}
