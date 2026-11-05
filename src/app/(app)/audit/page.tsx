import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { requirePermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import FilterBar from "@/components/FilterBar";
import { Card, EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { formatDateTime, num } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; action?: string }>;
}) {
  const user = await requirePermission("audit", "view");
  const tz = user.tenant.timezone;
  const sp = await searchParams;
  const db = await getDb();
  const q = sp.q?.trim() ? `%${sp.q.trim()}%` : null;

  const [entries, stats, actions] = await Promise.all([
    db`
      SELECT a.id, a.action, a.entity, a.summary, a.ip, a.created_at,
             u.full_name, r.role_name
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.user_id
        LEFT JOIN roles r ON r.id = u.role_id
       WHERE a.tenant_id = ${user.tenant_id}
         AND (${q}::text IS NULL OR a.summary ILIKE ${q} OR a.action ILIKE ${q}
              OR u.full_name ILIKE ${q})
         AND (${sp.action ?? null}::text IS NULL OR a.action = ${sp.action ?? null})
       ORDER BY a.created_at DESC
       LIMIT 300
    `,
    db`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '24 hours')::int AS today,
             COUNT(DISTINCT user_id)::int AS actors
        FROM audit_logs WHERE tenant_id = ${user.tenant_id}
    `,
    db`
      SELECT action, COUNT(*)::int AS c
        FROM audit_logs WHERE tenant_id = ${user.tenant_id}
       GROUP BY action ORDER BY c DESC LIMIT 25
    `,
  ]);

  const rows = entries as unknown as {
    id: string;
    action: string;
    entity: string | null;
    summary: string | null;
    ip: string | null;
    created_at: string;
    full_name: string | null;
    role_name: string | null;
  }[];
  const s = stats[0] as { total: number; today: number; actors: number };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every mutation recorded with who, what and when — the data-governance trail for the IT & MIS module."
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Entries recorded"
          value={num(s.total)}
          icon={<ShieldCheck size={16} />}
        />
        <KpiCard label="In the last 24 hours" value={num(s.today)} />
        <KpiCard label="Distinct actors" value={s.actors} />
      </section>

      <Card className="mt-4" bodyClassName="p-0">
        <FilterBar
          filters={[
            { name: "q", label: "Search", type: "search", value: sp.q, placeholder: "Summary, action, person" },
            {
              name: "action",
              label: "Action",
              type: "select",
              value: sp.action,
              options: (actions as unknown as { action: string; c: number }[]).map((a) => ({
                value: a.action,
                label: `${a.action} (${a.c})`,
              })),
            },
          ]}
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={20} />}
            title="No entries match"
            description="Audit rows are written as people use the system."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Summary</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="text-fg-muted text-xs whitespace-nowrap">
                      {formatDateTime(e.created_at, tz)}
                    </td>
                    <td>
                      <span className="block font-medium">{e.full_name ?? "System"}</span>
                      <span className="block text-xs text-fg-subtle">
                        {e.role_name ?? ""}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-neutral">{e.action}</span>
                    </td>
                    <td className="text-fg-muted">{e.summary ?? e.entity ?? "—"}</td>
                    <td className="text-fg-subtle text-xs tnum">{e.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
