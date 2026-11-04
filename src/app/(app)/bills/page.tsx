import type { Metadata } from "next";
import { Banknote } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { financeStats, listBills } from "@/lib/finance";
import { listPurchaseOrders, vendorOptions } from "@/lib/procurement";
import { createBillAction, recordPaymentAction } from "@/lib/actions/finance";
import AutoForm from "@/components/forms/AutoForm";
import FilterBar from "@/components/FilterBar";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, isoDate, money } from "@/lib/utils";

export const metadata: Metadata = { title: "Bills" };

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requirePermission("invoicing", "view");
  const sp = await searchParams;

  const [bills, stats, vendors, orders] = await Promise.all([
    listBills(user.tenant_id, { status: sp.status }),
    financeStats(user.tenant_id),
    vendorOptions(user.tenant_id),
    listPurchaseOrders(user.tenant_id, { status: "received" }),
  ]);

  const canCreate = hasPermission(user, "invoicing", "create");
  const currency = user.tenant.currency;
  const unpaid = bills.filter((b) => b.status !== "paid" && b.status !== "void");

  return (
    <>
      <PageHeader
        title="Bills"
        description="Accounts payable. A bill linked to a received purchase order is already in the ledger, so it is not posted twice."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Outstanding"
          value={money(stats.payable.outstanding, currency)}
          sub={`${stats.payable.open_count} open bills`}
          icon={<Banknote size={16} />}
        />
        <KpiCard
          label="Overdue"
          value={money(stats.payable.overdue, currency)}
          tone={stats.payable.overdue > 0 ? "danger" : "success"}
        />
        <KpiCard label="Paid out in total" value={money(stats.cash.outflow, currency)} />
        <KpiCard label="Bills recorded" value={bills.length} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <Card bodyClassName="p-0">
          <FilterBar
            filters={[
              {
                name: "status",
                label: "Status",
                type: "select",
                value: sp.status,
                options: ["draft", "pending", "partially_paid", "paid", "void"].map((s) => ({
                  value: s,
                  label: s.replace(/_/g, " "),
                })),
              },
            ]}
          />
          {bills.length === 0 ? (
            <EmptyState
              icon={<Banknote size={20} />}
              title="No bills recorded"
              description="Record a supplier bill to track what the company owes."
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Bill</th>
                    <th>Vendor</th>
                    <th>PO</th>
                    <th>Due</th>
                    <th className="right">Total</th>
                    <th className="right">Outstanding</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b) => {
                    const overdue =
                      b.due_date &&
                      new Date(b.due_date).getTime() < Date.now() &&
                      b.amount_paid < b.total_amount;
                    return (
                      <tr key={b.id}>
                        <td>
                          <span className="block font-medium">{b.bill_number}</span>
                          <span className="block text-xs text-fg-subtle">
                            {formatDate(b.issue_date)}
                          </span>
                        </td>
                        <td className="text-fg-muted">{b.vendor_name ?? "—"}</td>
                        <td className="text-fg-muted">{b.po_number ?? "—"}</td>
                        <td className={overdue ? "text-danger font-medium" : "text-fg-muted"}>
                          {formatDate(b.due_date)}
                        </td>
                        <td className="right">{money(b.total_amount, currency)}</td>
                        <td className="right font-semibold">
                          {money(b.total_amount - b.amount_paid, currency)}
                        </td>
                        <td>
                          <StatusBadge status={overdue ? "overdue" : b.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {canCreate && (
          <div className="grid gap-4">
            <Card title="Record a bill">
              <AutoForm
                action={createBillAction}
                columns={1}
                submitLabel="Record bill"
                resetOnSuccess
                fields={[
                  {
                    name: "vendorId",
                    label: "Vendor",
                    type: "select",
                    options: vendors.map((v) => ({ value: v.id, label: v.company_name })),
                  },
                  { name: "billNumber", label: "Vendor's bill number", help: "Generated if left blank." },
                  {
                    name: "purchaseOrderId",
                    label: "Against purchase order",
                    type: "select",
                    options: orders.map((o) => ({
                      value: o.id,
                      label: `${o.po_number} — ${money(o.total_amount, currency)}`,
                    })),
                    help: "Linking a received PO avoids posting the expense twice.",
                  },
                  { name: "subtotal", label: `Amount (${currency})`, type: "number", required: true, min: 0, step: "0.01" },
                  { name: "taxAmount", label: `Tax (${currency})`, type: "number", min: 0, step: "0.01", defaultValue: 0 },
                  { name: "issueDate", label: "Bill date", type: "date", required: true, defaultValue: isoDate() },
                  { name: "dueDate", label: "Due date", type: "date" },
                  { name: "notes", label: "Notes", type: "textarea", rows: 2 },
                ]}
              />
            </Card>

            {unpaid.length > 0 && (
              <Card title="Pay a bill">
                <AutoForm
                  action={recordPaymentAction}
                  hidden={{ direction: "out" }}
                  columns={1}
                  submitLabel="Record payment"
                  resetOnSuccess
                  fields={[
                    {
                      name: "billId",
                      label: "Bill",
                      type: "select",
                      required: true,
                      options: unpaid.map((b) => ({
                        value: b.id,
                        label: `${b.bill_number} — ${money(
                          b.total_amount - b.amount_paid,
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
                    { name: "paidOn", label: "Paid on", type: "date", required: true, defaultValue: isoDate() },
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
