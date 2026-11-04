import AppShell from "@/components/AppShell";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { hasPermission, isCompanyAdmin } from "@/lib/permissions";
import { NAV } from "@/lib/nav";

/**
 * Every signed-in page sits under this layout, so authentication and the
 * suspended-tenant lockout are enforced in exactly one place.
 *
 * The visible navigation is computed here from the user's role, and the list
 * of permitted hrefs is handed to the client shell. That is presentation only:
 * each page re-checks its own permission, because hiding a link is not access
 * control.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const db = await getDb();

  const unread = await db`
    SELECT COUNT(*)::int AS c
      FROM notifications
     WHERE tenant_id = ${user.tenant_id} AND user_id = ${user.id} AND read_at IS NULL
  `;

  const allowed = NAV.flatMap((group) =>
    group.items
      .filter((item) => {
        if (item.adminOnly) return isCompanyAdmin(user);
        if (!item.module) return true;
        return hasPermission(user, item.module, "view");
      })
      .map((item) => item.href)
  );

  return (
    <AppShell
      user={{
        full_name: user.full_name,
        email: user.email,
        role_name: user.role_name,
        avatar_url: user.avatar_url,
        company_name: user.tenant.company_name,
        theme: user.theme,
        is_platform_admin: user.is_platform_admin,
      }}
      allowed={allowed}
      unreadCount={(unread[0] as { c: number }).c}
    >
      {children}
    </AppShell>
  );
}
