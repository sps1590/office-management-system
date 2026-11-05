import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import {
  listPurchaseOrders,
  procurementStats,
  vendorOptions,
} from "@/lib/procurement";
import { getSettings } from "@/lib/settings";
import FilterBar from "@/components/FilterBar";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { compact, formatDate, money, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Purchase orders" };

export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; vendor?: string }>;
}) {
  const user = await requirePermission("procurement", "view");
  const sp = await searchParams;

  const [orders, stats, vendors, queue, settings] = await Promise.all([
    listPurchaseOrders(user.tenant_id, { status: sp.status, vendorId: sp.vendor }),
    procurementStats(user.tenant_id),
    vendorOptions(user.tenant_id),
    listPurchaseOrders(user.tenant_id, { awaitingUserId: user.id }),
    getSettings(user.tenant_id),
  ]);

  const currency = user.tenant.currency;

  const tz = user.tenant.timezone;
  const canCreate = hasPermission(user, "procurement", "create");

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description={`Approval tiers: ${
          settings.po_approval_tiers
            .map((t) => `${titleCase(t.role)} above ${currency} ${compact(t.amount)}`)
            .join(", ") || "none configured"
        }.`}
      >
        {canCreate && (
          <Link href="/procurement/new" className="btn btn-primary">
            <Plus size={15} />
            New purchase order
          </Link>
        )}
      </PageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Awaiting your approval"
          value={queue.length}
          tone={queue.length > 0 ? "warning" : "success"}
          icon={<FileText size={16} />}
        />
        <KpiCard
          label="Pending company-wide"
          value={stats.pending}
          sub={`${money(stats.pending_value, currency)} in value`}
          tone={stats.pending > 0 ? "info" : "default"}
        />
        <KpiCard label="Approved, not received" value={stats.approved} />
        <KpiCard
          label="Committed this year"
          value={`${currency} ${compact(stats.committed_ytd)}`}
          sub={`${stats.received} orders received`}
        />
      </section>

      {queue.length > 0 && (
        <Card title="Awaiting your decision" className="mt-4" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {queue.map((po) => (
              <li key={po.id} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/procurement/${po.id}`}
                    className="font-medium hover:text-primary transition-colors"
                  >
                    {po.po_number}
                  </Link>
                  <p className="text-sm text-fg-muted">
                    {po.vendor_name} · {po.item_count} line(s) · tier {po.current_tier} of{" "}
                    {po.total_tiers}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-semibold tnum">
                    {money(po.total_amount, currency)}
                  </span>
                  <Link href={`/procurement/${po.id}`} className="btn btn-primary btn-sm">
                    Review
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-4" bodyClassName="p-0">
        <FilterBar
          filters={[
            {
              name: "status",
              label: "Status",
              type: "select",
              value: sp.status,
              options: [
                "draft",
                "pending",
                "approved",
                "partially_received",
                "received",
                "rejected",
                "cancelled",
              ].map((s) => ({ value: s, label: s.replace(/_/g, " ") })),
            },
            {
              name: "vendor",
              label: "Vendor",
              type: "select",
              value: sp.vendor,
              options: vendors.map((v) => ({ value: v.id, label: v.company_name })),
            },
          ]}
        />
        {orders.length === 0 ? (
          <EmptyState
            icon={<FileText size={20} />}
            title="No purchase orders"
            description="Raise one against an approved vendor to start the approval chain."
            action={
              canCreate ? (
                <Link href="/procurement/new" className="btn btn-primary">
                  <Plus size={15} />
                  New purchase order
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Vendor</th>
                  <th>Ordered</th>
                  <th>Expected</th>
                  <th className="right">Lines</th>
                  <th className="right">Total</th>
                  <th>Awaiting</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((po) => (
                  <tr key={po.id}>
                    <td>
                      <Link
                        href={`/procurement/${po.id}`}
                        className="font-medium hover:text-primary transition-colors"
                      >
                        {po.po_number}
                      </Link>
                      <span className="block text-xs text-fg-subtle">
                        {po.requester_name ?? "—"}
                      </span>
                    </td>
                    <td className="text-fg-muted">{po.vendor_name}</td>
                    <td className="text-fg-muted">{formatDate(po.order_date, tz)}</td>
                    <td className="text-fg-muted">{formatDate(po.expected_date, tz)}</td>
                    <td className="right">{po.item_count}</td>
                    <td className="right font-semibold">
                      {money(po.total_amount, currency)}
                    </td>
                    <td className="text-fg-muted">
                      {po.status === "pending"
                        ? (po.awaiting_name ?? `Tier ${po.current_tier}`)
                        : "—"}
                    </td>
                    <td>
                      <StatusBadge status={po.status} />
                    </td>
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
