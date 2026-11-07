import { getSessionUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { isoDate } from "@/lib/utils";

/**
 * The annual leave allotment sheet, already filled in.
 *
 * One row per active employee, one column per active leave category, every
 * cell carrying what that person is entitled to today. That makes the file an
 * edit rather than a transcription: change the three numbers that are wrong
 * and send it back.
 *
 * A blank cell on the way back in means "leave this category alone", so the
 * generated file deliberately contains a number everywhere — a person
 * clearing a cell is then saying something different from a person who never
 * touched it.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  if (!hasPermission(user, "leave", "edit")) {
    return new Response("You cannot set leave allotments.", { status: 403 });
  }

  const asked = Number(new URL(request.url).searchParams.get("year"));
  const year =
    asked >= 2000 && asked <= 2100
      ? asked
      : Number(isoDate(user.tenant.timezone).slice(0, 4));

  const db = await getDb();
  const [typeRows, staffRows, balanceRows] = await Promise.all([
    db`
      SELECT id, name, annual_quota::float AS annual_quota
        FROM leave_types
       WHERE tenant_id = ${user.tenant_id} AND is_active = TRUE
       ORDER BY sort_order, name
    `,
    db`
      SELECT id, full_name, email, employee_code
        FROM users
       WHERE tenant_id = ${user.tenant_id} AND status = 'active'
       ORDER BY full_name
    `,
    db`
      SELECT user_id, leave_type_id, entitled::float AS entitled
        FROM leave_balances
       WHERE tenant_id = ${user.tenant_id} AND year = ${year}
    `,
  ]);

  const types = typeRows as unknown as { id: string; name: string; annual_quota: number }[];
  const staff = staffRows as unknown as {
    id: string;
    full_name: string;
    email: string;
    employee_code: string | null;
  }[];

  // Keyed by "user:type" so the sheet is filled without a query per person.
  const entitled = new Map(
    (balanceRows as unknown as { user_id: string; leave_type_id: string; entitled: number }[]).map(
      (b) => [`${b.user_id}:${b.leave_type_id}`, b.entitled]
    )
  );

  const headers = ["employee_code", "email", "full_name", ...types.map((t) => t.name)];
  const rows = staff.map((s) => [
    s.employee_code ?? "",
    s.email,
    s.full_name,
    // Falling back to the category's own annual quota, which is what the
    // person is on when nobody has set them an individual figure.
    ...types.map((t) => entitled.get(`${s.id}:${t.id}`) ?? t.annual_quota),
  ]);

  const csv = toCsv(headers, rows);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leave-allotment-${year}.csv"`,
      "Cache-Control": "no-store, private",
    },
  });
}
