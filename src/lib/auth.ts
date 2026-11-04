import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getDb } from "./db";
import { expandMatrix, type PermissionsMatrix } from "./modules";
import type { SessionUser, UserRow } from "./types";

const SESSION_COOKIE = "oms_session";
const SESSION_DAYS = 14;
export const BCRYPT_COST = 10;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_COST);
}

export function verifyPassword(user: Pick<UserRow, "password_hash">, plain: string): boolean {
  return bcrypt.compareSync(plain, user.password_hash);
}

/**
 * Login lookup. Returns null rather than throwing when nothing matches, so
 * the caller can answer with the same generic message either way and never
 * reveal whether an account exists.
 */
export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const db = await getDb();
  const rows = await db`
    SELECT id, tenant_id, role_id, password_hash, full_name, email, status, is_platform_admin
      FROM users WHERE LOWER(email) = LOWER(${email})
      -- tenancy-ok: login happens before any tenant is known
  `;
  return (rows[0] as UserRow | undefined) ?? null;
}

async function requestMeta() {
  const h = await headers();
  return {
    ip:
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      null,
    userAgent: h.get("user-agent")?.slice(0, 400) ?? null,
  };
}

export async function createSession(userId: string, tenantId: string): Promise<void> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  const { ip, userAgent } = await requestMeta();

  await db`
    INSERT INTO sessions (id, user_id, tenant_id, expires_at, ip, user_agent)
    VALUES (${id}, ${userId}, ${tenantId}, ${expiresAt}, ${ip}, ${userAgent})
  `;
  await db`UPDATE users SET last_login_at = now() WHERE id = ${userId}
           -- tenancy-ok: the id is the account that just authenticated`;

  const store = await cookies();
  store.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const sid = store.get(SESSION_COOKIE)?.value;
  if (sid) {
    const db = await getDb();
    await db`DELETE FROM sessions WHERE id = ${sid}
             -- tenancy-ok: a session id is already a single tenant's row`;
  }
  store.delete(SESSION_COOKIE);
}

type SessionRow = {
  user_id: string;
  tenant_id: string;
  role_id: string | null;
  role_key: string | null;
  role_name: string | null;
  permissions_matrix: PermissionsMatrix | null;
  department_id: string | null;
  department_name: string | null;
  line_manager_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  employee_code: string | null;
  designation: string | null;
  avatar_url: string | null;
  user_status: SessionUser["status"];
  locale: string;
  theme: string;
  is_platform_admin: boolean;
  expires_at: string;
  company_name: string;
  slug: string;
  tenant_status: SessionUser["tenant"]["status"];
  plan_key: string;
  currency: string;
  timezone: string;
  logo_url: string | null;
};

/**
 * Resolves the session cookie into everything a request needs — user, role,
 * expanded permission matrix and tenant — in one query. Returns null when
 * there is no valid session.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const sid = store.get(SESSION_COOKIE)?.value;
  if (!sid) return null;

  const db = await getDb();
  const rows = await db`
    SELECT u.id          AS user_id,
           u.tenant_id,
           u.role_id,
           r.key          AS role_key,
           r.role_name,
           r.permissions_matrix,
           u.department_id,
           d.name         AS department_name,
           u.line_manager_id,
           u.full_name, u.email, u.phone, u.employee_code, u.designation,
           u.avatar_url,
           u.status       AS user_status,
           u.locale, u.theme, u.is_platform_admin,
           s.expires_at,
           t.company_name, t.slug,
           t.status       AS tenant_status,
           t.plan_key, t.currency, t.timezone, t.logo_url
      FROM sessions s
      JOIN users u   ON u.id = s.user_id
      JOIN tenants t ON t.id = u.tenant_id
      LEFT JOIN roles r       ON r.id = u.role_id
      LEFT JOIN departments d ON d.id = u.department_id
     WHERE s.id = ${sid}
     -- tenancy-ok: the session id resolves to exactly one tenant's user
  `;

  const row = rows[0] as SessionRow | undefined;
  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db`DELETE FROM sessions WHERE id = ${sid}
             -- tenancy-ok: expiring the caller's own session`;
    return null;
  }

  // A deactivated account keeps no access even with a live cookie.
  if (row.user_status === "suspended" || row.user_status === "left") return null;

  return {
    id: row.user_id,
    tenant_id: row.tenant_id,
    role_id: row.role_id,
    role_key: row.role_key,
    role_name: row.role_name,
    department_id: row.department_id,
    department_name: row.department_name,
    line_manager_id: row.line_manager_id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    employee_code: row.employee_code,
    designation: row.designation,
    avatar_url: row.avatar_url,
    status: row.user_status,
    locale: row.locale,
    theme: row.theme,
    is_platform_admin: row.is_platform_admin,
    tenant: {
      id: row.tenant_id,
      company_name: row.company_name,
      slug: row.slug,
      status: row.tenant_status,
      plan_key: row.plan_key,
      currency: row.currency,
      timezone: row.timezone,
      logo_url: row.logo_url,
    },
    permissions: expandMatrix(row.permissions_matrix),
  };
}

/**
 * The gate every signed-in page and Server Action starts with. A suspended
 * tenant is locked out of the whole application, not just the login screen,
 * so an already-open session stops working too. Platform admins are exempt so
 * they can still inspect a suspended company.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (
    (user.tenant.status === "suspended" || user.tenant.status === "cancelled") &&
    !user.is_platform_admin
  ) {
    redirect("/suspended");
  }
  return user;
}

export async function setUserTheme(userId: string, theme: string): Promise<void> {
  const db = await getDb();
  await db`UPDATE users SET theme = ${theme} WHERE id = ${userId}
           -- tenancy-ok: userId comes from the caller's own session`;
}
