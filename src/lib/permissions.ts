import "server-only";
import { redirect } from "next/navigation";
import { getSessionUser, requireUser } from "./auth";
import type { Module, PermAction } from "./modules";
import type { SessionUser } from "./types";

/** Roles that bypass the configurable matrix entirely. */
const ADMIN_ROLE_KEYS = new Set(["company_admin", "super_admin"]);

export function isCompanyAdmin(user: SessionUser): boolean {
  return ADMIN_ROLE_KEYS.has(user.role_key ?? "");
}

/**
 * A company admin always has full access regardless of what is stored in the
 * matrix, so a mis-edited matrix can never lock the owner out of their own
 * company — and user/role management is never gated through the matrix at
 * all (see requireCompanyAdmin).
 */
export function hasPermission(
  user: SessionUser,
  module: Module,
  action: PermAction
): boolean {
  if (isCompanyAdmin(user)) return true;
  return user.permissions[module]?.[action] ?? false;
}

/**
 * Redirects rather than throws on failure. This runs both at the top of gated
 * pages — where a thrown error would show Next's generic crash screen for
 * what is really "you cannot see this" — and inside Server Actions, where a
 * quiet redirect is the right answer to a forged or bypassed-UI request.
 */
export async function requirePermission(
  module: Module,
  action: PermAction
): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasPermission(user, module, action)) redirect("/dashboard");
  return user;
}

/**
 * Managing users, roles and the permission matrix. Hard-coded to the company
 * admin and never driven by the `users` module permission, because letting a
 * permission govern who may edit permissions is a privilege-escalation path.
 */
export async function requireCompanyAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isCompanyAdmin(user)) redirect("/dashboard");
  return user;
}

/**
 * Super Admin: the operator of the whole platform, who can see every tenant.
 * Set only from the PLATFORM_ADMIN_IDENTIFIERS env var (see syncPlatformAdmins
 * in db.ts) — never from the UI or a tenant's permission matrix, so a company
 * admin cannot grant it to themselves.
 */
export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.is_platform_admin) redirect("/dashboard");
  return user;
}

/**
 * Self-service pages: anyone may act on their own record, while acting on
 * someone else's needs the module permission. Used by attendance, leave,
 * expense claims and payslips, where every employee has a personal view of
 * the same table a manager sees in full.
 */
export async function requireSelfOr(
  targetUserId: string,
  module: Module,
  action: PermAction
): Promise<SessionUser> {
  const user = await requireUser();
  if (user.id === targetUserId) return user;
  if (!hasPermission(user, module, action)) redirect("/dashboard");
  return user;
}

/** True when the user may see other people's rows in this module. */
export function canSeeEveryone(user: SessionUser, module: Module): boolean {
  return isCompanyAdmin(user) || hasPermission(user, module, "edit");
}
