import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { financeStats, listInvoices, listPayments } from "@/lib/finance";
import { clientOptions, listDeals } from "@/lib/crm";
import { recordPaymentAction } from "@/lib/actions/finance";
import AutoForm from "@/components/forms/AutoForm";
import InvoiceForm from "@/components/forms/InvoiceForm";
import FilterBar from "@/components/FilterBar";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, isoDate, money } from "@/lib/utils";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requirePermission("invoicing", "view");
  const sp = await searchParams;

  const [invoices, stats, clients, deals, payments] = await Promise.all([
    listInvoices(user.tenant_id, { status: sp.status }),
    financeStats(user.tenant_id),
    clientOptions(user.tenant_id),
    listDeals(user.tenant_id, { status: "open" }),
    listPayments(user.tenant_id, 15),
  ]);

  const canCreate = hasPermission(user, "invoicing", "create");
  const currency = user.tenant.currency;
  const unpaid = invoices.filter(
    (i) => i.status !== "paid" && i.status !== "void" && i.status !== "draft"
  );

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Accounts receivable. Raising an invoice posts it to the ledger; receipts are recorded separately."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Outstanding"
          value={money(stats.receivable.outstanding, currency)}
          sub={`${stats.receivable.open_count} open invoices`}
          icon={<Receipt size={16} />}
        />
        <KpiCard
          label="Overdue"
          value={money(stats.receivable.overdue, currency)}
          tone={stats.receivable.overdue > 0 ? "danger" : "success"}
        />
        <KpiCard
          label="Received in total"
          value={money(stats.cash.inflow, currency)}
          tone="success"
        />
        <KpiCard label="Invoices raised" value={invoices.length} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px] mt-4 items-start">
        <div className="grid gap-4">
          <Card bodyClassName="p-0">
            <FilterBar
              filters={[
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  value: sp.status,
                  options: [
                    "draft",
                    "sent",
                    "partially_paid",
                    "paid",
                    "overdue",
                    "void",
                  ].map((s) => ({ value: s, label: s.replace(/_/g, " ") })),
                },
              ]}
            />
            {invoices.length === 0 ? (
              <EmptyState
                icon={<Receipt size={20} />}
                title="No invoices yet"
                description="Raise one against a client to start tracking receivables."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Client</th>
                      <th>Issued</th>
                      <th>Due</th>
                      <th className="right">Total</th>
                      <th className="right">Paid</th>
                      <th className="right">Outstanding</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((i) => {
                      const overdue =
                        i.due_date &&
                        new Date(i.due_date).getTime() < Date.now() &&
                        i.amount_paid < i.total_amount;
                      return (
                        <tr key={i.id}>
                          <td>
                            <span className="block font-medium">{i.invoice_number}</span>
                            <span className="block text-xs text-fg-subtle">
                              {i.line_count} line{i.line_count === 1 ? "" : "s"}
                            </span>
                          </td>
                          <td className="text-fg-muted">{i.client_name ?? "—"}</td>
                          <td className="text-fg-muted">{formatDate(i.issue_date)}</td>
                          <td className={overdue ? "text-danger font-medium" : "text-fg-muted"}>
                            {formatDate(i.due_date)}
                          </td>
                          <td className="right">{money(i.total_amount, currency)}</td>
                          <td className="right">{money(i.amount_paid, currency)}</td>
                          <td className="right font-semibold">
                            {money(i.total_amount - i.amount_paid, currency)}
                          </td>
                          <td>
                            <StatusBadge status={overdue ? "overdue" : i.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Recent payments" bodyClassName="p-0">
            {payments.length === 0 ? (
              <p className="px-5 py-5 text-sm text-fg-subtle">No payments recorded yet.</p>
            ) : (
              <div className="table-wrap max-h-72 overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Direction</th>
                      <th>Document</th>
                      <th>Method</th>
                      <th className="right">Amount</th>
                      <th>Recorded by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="text-fg-muted">{formatDate(p.paid_on)}</td>
                        <td>
                          <span
                            className={
                              p.direction === "in" ? "badge badge-success" : "badge badge-warning"
                            }
                          >
                            {p.direction === "in" ? "received" : "paid"}
                          </span>
                        </td>
                        <td className="font-medium">
                          {p.invoice_number ?? p.bill_number ?? "—"}
                        </td>
                        <td className="text-fg-muted capitalize">{p.method}</td>
                        <td className="right">{money(p.amount, currency)}</td>
                        <td className="text-fg-muted">{p.created_by_name ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {canCreate && (
          <div className="grid gap-4">
            <Card title="Raise an invoice">
              <InvoiceForm
                clients={clients.map((c) => ({ id: c.id, name: c.name }))}
                deals={deals.map((d) => ({ id: d.id, title: d.title }))}
                currency={currency}
                today={isoDate()}
              />
            </Card>

            {unpaid.length > 0 && (
              <Card title="Record a receipt">
                <AutoForm
                  action={recordPaymentAction}
                  hidden={{ direction: "in" }}
                  columns={1}
                  submitLabel="Record receipt"
                  resetOnSuccess
                  fields={[
                    {
                      name: "invoiceId",
                      label: "Invoice",
                      type: "select",
                      required: true,
                      options: unpaid.map((i) => ({
                        value: i.id,
                        label: `${i.invoice_number} — ${money(
                          i.total_amount - i.amount_paid,
                          currency
                        )} outstanding`,
                      })),
                    },
                    { name: "amount", label: `Amount (${currency})`, type: "number", required: true, min: 0, step: "0.01" },
                    {
                      name: "method",
                      label: "Method",
                      type: "select",
                      required: true,
                      defaultValue: "bank",
                      options: ["cash", "bank", "cheque", "mobile", "card", "other"].map(
                        (m) => ({ value: m, label: m })
                      ),
                    },
                    { name: "paidOn", label: "Received on", type: "date", required: true, defaultValue: isoDate() },
                    { name: "reference", label: "Reference" },
                  ]}
                />
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}
