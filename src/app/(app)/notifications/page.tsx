import type { Metadata } from "next";
import Link from "next/link";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { markNotificationsReadAction } from "@/lib/actions/admin";
import ActionButton from "@/components/ActionButton";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { cn, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const db = await getDb();

  const rows = await db`
    SELECT id, title, body, kind, severity, link, read_at, created_at
      FROM notifications
     WHERE tenant_id = ${user.tenant_id} AND user_id = ${user.id}
     ORDER BY created_at DESC
     LIMIT 100
  `;
  const items = rows as unknown as {
    id: string;
    title: string;
    body: string | null;
    kind: string;
    severity: string;
    link: string | null;
    read_at: string | null;
    created_at: string;
  }[];
  const unread = items.filter((n) => !n.read_at);

  return (
    <>
      <PageHeader
        title="Notifications"
        description={
          unread.length > 0
            ? `${unread.length} unread`
            : "Everything here has been read."
        }
      >
        {unread.length > 0 && (
          <ActionButton
            action={markNotificationsReadAction}
            values={{ notificationId: "all" }}
            label="Mark all read"
            className="btn-secondary"
            icon={<CheckCheck size={15} />}
          />
        )}
      </PageHeader>

      <Card bodyClassName="p-0">
        {items.length === 0 ? (
          <EmptyState
            icon={<BellOff size={20} />}
            title="Nothing yet"
            description="Approvals, assignments, geofence alerts and payroll notices arrive here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((n) => (
              <li
                key={n.id}
                className={cn(
                  "px-5 py-4 flex items-start justify-between gap-4",
                  !n.read_at && "bg-primary-soft/40"
                )}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className={cn(
                      "grid place-items-center h-8 w-8 rounded-lg shrink-0",
                      n.severity === "critical" || n.severity === "high"
                        ? "bg-warning-soft text-warning"
                        : "bg-surface-hover text-fg-subtle"
                    )}
                  >
                    <Bell size={15} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{n.title}</p>
                    {n.body && <p className="text-sm text-fg-muted mt-0.5">{n.body}</p>}
                    <p className="text-xs text-fg-subtle mt-1">
                      {relativeTime(n.created_at)}
                      {n.kind !== "info" ? ` · ${n.kind}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {n.link && (
                    <Link href={n.link} className="btn btn-ghost btn-sm">
                      Open
                    </Link>
                  )}
                  {!n.read_at && (
                    <ActionButton
                      action={markNotificationsReadAction}
                      values={{ notificationId: n.id }}
                      label="Read"
                      className="btn-ghost btn-sm"
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
