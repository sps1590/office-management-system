import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, PackageCheck, Send, X } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { getPurchaseOrder } from "@/lib/procurement";
import {
  decidePurchaseOrderAction,
  receivePurchaseOrderAction,
  submitPurchaseOrderAction,
} from "@/lib/actions/procurement";
import ActionButton from "@/components/ActionButton";
import { Card, Field, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, formatDateTime, money, num, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("procurement", "view");
  const { id } = await params;

  const po = await getPurchaseOrder(user.tenant_id, id);
  if (!po) notFound();

  const { header, items, approvals } = po;
  const currency = header.currency ?? user.tenant.currency;
  const canCreate = hasPermission(user, "procurement", "create");
  const canEdit = hasPermission(user, "procurement", "edit");

  const currentTier = approvals.find((a) => a.tier === header.current_tier);
  const myTurn =
    header.status === "pending" &&
    currentTier?.decision === "pending" &&
    (currentTier.approver_name === user.full_name ||
      hasPermission(user, "procurement", "approve"));

  const receivedLines = items.filter((i) => i.received_quantity >= i.quantity).length;

  return (
    <>
      <Link href="/procurement" className="btn btn-ghost btn-sm mb-4">
        <ArrowLeft size={15} />
        Purchase orders
      </Link>

      <PageHeader
        title={header.po_number}
        description={`${header.vendor_name} · raised by ${header.requester_name ?? "—"} on ${formatDate(header.order_date)}`}
      >
        <StatusBadge status={header.status} />
        {canCreate && header.status === "draft" && (
          <ActionButton
            action={submitPurchaseOrderAction}
            values={{ poId: header.id }}
            label="Submit for approval"
            className="btn-primary"
            icon={<Send size={15} />}
          />
        )}
        {myTurn && (
          <>
            <ActionButton
              action={decidePurchaseOrderAction}
              values={{ poId: header.id, decision: "approved" }}
              label={`Approve tier ${header.current_tier}`}
              className="btn-primary"
              icon={<Check size={15} />}
            />
            <ActionButton
              action={decidePurchaseOrderAction}
              values={{ poId: header.id, decision: "rejected" }}
              label="Decline"
              className="btn-secondary"
              confirm="Decline this purchase order?"
              icon={<X size={15} />}
            />
          </>
        )}
        {canEdit && (header.status === "approved" || header.status === "partially_received") && (
          <ActionButton
            action={receivePurchaseOrderAction}
            values={{ poId: header.id }}
            label="Receive into stock"
            className="btn-primary"
            icon={<PackageCheck size={15} />}
            confirm="Mark every line as received? This adds the goods to stock and posts the payable to accounts."
          />
        )}
      </PageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total" value={money(header.total_amount, currency)} />
        <KpiCard label="Lines" value={`${receivedLines}/${items.length} received`} />
        <KpiCard
          label="Approval"
          value={`${header.current_tier}/${header.total_tiers}`}
          sub={
            header.status === "pending"
              ? `Awaiting ${currentTier?.approver_name ?? "approver"}`
              : titleCase(header.status)
          }
          tone={header.status === "approved" || header.status === "received" ? "success" : "default"}
        />
        <KpiCard
          label="Expected"
          value={formatDate(header.expected_date)}
          sub={header.received_date ? `Received ${formatDate(header.received_date)}` : undefined}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px] mt-4 items-start">
        <div className="grid gap-4">
          <Card title="Line items" bodyClassName="p-0">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="right">Quantity</th>
                    <th className="right">Received</th>
                    <th className="right">Unit price</th>
                    <th className="right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <span className="block font-medium">{line.description}</span>
                        {line.sku && (
                          <span className="block text-xs text-fg-subtle">{line.sku}</span>
                        )}
                      </td>
                      <td className="right">
                        {num(line.quantity, 0)} {line.unit ?? ""}
                      </td>
                      <td className="right">
                        {line.received_quantity >= line.quantity ? (
                          <span className="badge badge-success">Full</span>
                        ) : (
                          num(line.received_quantity, 0)
                        )}
                      </td>
                      <td className="right">{money(line.unit_price, currency)}</td>
                      <td className="right font-semibold">
                        {money(line.line_total, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="p-5 border-t border-border space-y-2 max-w-xs ml-auto">
              <div className="flex justify-between text-sm">
                <dt className="text-fg-muted">Subtotal</dt>
                <dd className="tnum">{money(header.subtotal, currency)}</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-fg-muted">Tax</dt>
                <dd className="tnum">{money(header.tax_amount, currency)}</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-fg-muted">Shipping</dt>
                <dd className="tnum">{money(header.shipping_amount, currency)}</dd>
              </div>
              <div className="flex justify-between pt-2 border-t border-border font-semibold">
                <dt>Total</dt>
                <dd className="tnum">{money(header.total_amount, currency)}</dd>
              </div>
            </dl>
          </Card>

          <Card title="Approval trail" bodyClassName="p-0">
            {approvals.length === 0 ? (
              <p className="px-5 py-5 text-sm text-fg-subtle">
                Not submitted for approval yet.
              </p>
            ) : (
              <ol className="divide-y divide-border">
                {approvals.map((a) => (
                  <li key={a.tier} className="px-5 py-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        Tier {a.tier} · {titleCase(a.approver_role ?? "")}
                      </p>
                      <p className="text-xs text-fg-subtle">
                        {a.approver_name ?? "Unassigned"}
                        {a.threshold_amount != null
                          ? ` · threshold ${money(a.threshold_amount, currency)}`
                          : ""}
                        {a.decided_at ? ` · ${formatDateTime(a.decided_at)}` : ""}
                      </p>
                      {a.comments && (
                        <p className="mt-1 text-sm text-fg-muted italic">
                          &ldquo;{a.comments}&rdquo;
                        </p>
                      )}
                    </div>
                    <StatusBadge status={a.decision} />
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="grid gap-4">
          <Card title="Vendor">
            <dl>
              <Field label="Company">{header.vendor_name}</Field>
              <Field label="Email">{header.vendor_email ?? "—"}</Field>
              <Field label="Phone">{header.vendor_phone ?? "—"}</Field>
              <Field label="Deliver to">{header.warehouse_name ?? "—"}</Field>
            </dl>
          </Card>

          {(header.terms || header.notes) && (
            <Card title="Terms and notes">
              {header.terms && (
                <p className="text-sm text-fg-muted whitespace-pre-wrap">{header.terms}</p>
              )}
              {header.notes && (
                <p className="text-sm text-fg-muted whitespace-pre-wrap mt-3 pt-3 border-t border-border">
                  {header.notes}
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
