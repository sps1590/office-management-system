import type { Metadata } from "next";
import { Check, MapPin, Send, Wallet, X } from "lucide-react";
import { canSeeEveryone, hasPermission, requirePermission } from "@/lib/permissions";
import { financeStats, listExpenseClaims } from "@/lib/finance";
import { createExpenseClaimAction, decideExpenseClaimAction } from "@/lib/actions/finance";
import ActionButton from "@/components/ActionButton";
import GeoActionForm from "@/components/GeoActionForm";
import FilterBar from "@/components/FilterBar";
import { Avatar, Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, isoDate, money } from "@/lib/utils";

export const metadata: Metadata = { title: "Expense claims" };

const CATEGORIES = [
  "travel",
  "fuel",
  "meals",
  "accommodation",
  "client_entertainment",
  "stationery",
  "communication",
  "medical",
  "training",
  "other",
];

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requirePermission("expenses", "view");
  const sp = await searchParams;

  const seesAll = canSeeEveryone(user, "expenses");
  const canApprove = hasPermission(user, "expenses", "approve");

  const [claims, mine, stats] = await Promise.all([
    listExpenseClaims(user.tenant_id, {
      status: sp.status,
      userId: seesAll ? undefined : user.id,
    }),
    listExpenseClaims(user.tenant_id, { userId: user.id }),
    financeStats(user.tenant_id),
  ]);

  const currency = user.tenant.currency;

  const tz = user.tenant.timezone;
  const queue = claims.filter((c) => c.status === "pending" && c.user_id !== user.id);
  const approvedUnpaid = claims.filter((c) => c.status === "approved");
  const myPending = mine.filter((c) => c.status === "pending").length;

  return (
    <>
      <PageHeader
        title="Expense claims"
        description="Submit a claim, finance verifies it, then marks it reimbursed. Approval and reimbursement post separately to the ledger."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="My claims pending"
          value={myPending}
          icon={<Wallet size={16} />}
          tone={myPending > 0 ? "info" : "default"}
        />
        {canApprove ? (
          <>
            <KpiCard
              label="To verify"
              value={stats.expenses.pending}
              sub={money(stats.expenses.pending_amount, currency)}
              tone={stats.expenses.pending > 0 ? "warning" : "success"}
            />
            <KpiCard
              label="Approved, not reimbursed"
              value={approvedUnpaid.length}
              sub={money(
                approvedUnpaid.reduce((s, c) => s + c.amount, 0),
                currency
              )}
              tone={approvedUnpaid.length > 0 ? "info" : "default"}
            />
          </>
        ) : (
          <>
            <KpiCard
              label="My claims this year"
              value={mine.length}
              sub={money(
                mine.reduce((s, c) => s + c.amount, 0),
                currency
              )}
            />
            <KpiCard
              label="Reimbursed to me"
              value={money(
                mine.filter((c) => c.status === "reimbursed").reduce((s, c) => s + c.amount, 0),
                currency
              )}
              tone="success"
            />
          </>
        )}
        <KpiCard
          label="Reimbursed this year"
          value={money(stats.expenses.reimbursed_ytd, currency)}
          tone="success"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          {canApprove && queue.length > 0 && (
            <Card title="Awaiting verification" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {queue.map((c) => (
                  <li key={c.id} className="p-5 flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <Avatar name={c.user_name} size={34} />
                      <div className="min-w-0">
                        <p className="font-medium">
                          {money(c.amount, currency)} ·{" "}
                          <span className="capitalize font-normal">
                            {c.category.replace(/_/g, " ")}
                          </span>
                        </p>
                        <p className="text-sm text-fg-muted">
                          {c.user_name} · {formatDate(c.expense_date, tz)} ·{" "}
                          {c.claim_number ?? "—"}
                        </p>
                        {c.description && (
                          <p className="mt-1 text-sm text-fg-muted italic">
                            &ldquo;{c.description}&rdquo;
                          </p>
                        )}
                        {c.latitude != null && (
                          <p className="mt-1 text-xs text-fg-subtle flex items-center gap-1">
                            <MapPin size={11} />
                            Captured at {c.latitude.toFixed(4)}, {c.longitude?.toFixed(4)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <ActionButton
                        action={decideExpenseClaimAction}
                        values={{ claimId: c.id, decision: "approved" }}
                        label="Approve"
                        className="btn-primary btn-sm"
                        icon={<Check size={14} />}
                      />
                      <ActionButton
                        action={decideExpenseClaimAction}
                        values={{ claimId: c.id, decision: "rejected" }}
                        label="Reject"
                        className="btn-secondary btn-sm"
                        confirm="Reject this claim?"
                        icon={<X size={14} />}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {canApprove && approvedUnpaid.length > 0 && (
            <Card title="Approved — ready to reimburse" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {approvedUnpaid.map((c) => (
                  <li key={c.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {c.user_name} · {money(c.amount, currency)}
                      </p>
                      <p className="text-xs text-fg-subtle capitalize">
                        {c.category.replace(/_/g, " ")} · approved by {c.approver_name ?? "—"}
                      </p>
                    </div>
                    <ActionButton
                      action={decideExpenseClaimAction}
                      values={{ claimId: c.id, decision: "reimbursed" }}
                      label="Mark reimbursed"
                      className="btn-secondary btn-sm"
                      icon={<Send size={14} />}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={seesAll ? "All claims" : "My claims"} bodyClassName="p-0">
            <FilterBar
              filters={[
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  value: sp.status,
                  options: ["pending", "approved", "rejected", "reimbursed"].map((s) => ({
                    value: s,
                    label: s,
                  })),
                },
              ]}
            />
            {claims.length === 0 ? (
              <EmptyState
                icon={<Wallet size={20} />}
                title="No claims"
                description="Submit a claim using the form."
              />
            ) : (
              <div className="table-wrap max-h-[32rem] overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Claim</th>
                      {seesAll && <th>Employee</th>}
                      <th>Category</th>
                      <th>Date</th>
                      <th className="right">Amount</th>
                      <th>Verified by</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <span className="block font-medium">{c.claim_number ?? "—"}</span>
                          {c.description && (
                            <span className="block text-xs text-fg-subtle truncate max-w-56">
                              {c.description}
                            </span>
                          )}
                        </td>
                        {seesAll && <td className="text-fg-muted">{c.user_name}</td>}
                        <td className="text-fg-muted capitalize">
                          {c.category.replace(/_/g, " ")}
                        </td>
                        <td className="text-fg-muted">{formatDate(c.expense_date, tz)}</td>
                        <td className="right font-semibold">{money(c.amount, currency)}</td>
                        <td className="text-fg-muted">{c.approver_name ?? "—"}</td>
                        <td>
                          <StatusBadge status={c.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {hasPermission(user, "expenses", "create") && (
          <Card title="Submit a claim">
            <GeoActionForm
              action={createExpenseClaimAction}
              submitLabel="Submit claim"
              className="btn-primary w-full"
              required={false}
            >
              <div>
                <label className="label" htmlFor="category">
                  Category
                </label>
                <select id="category" name="category" required className="input" defaultValue="travel">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c} className="capitalize">
                      {c.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="amount">
                  Amount ({currency})
                </label>
                <input
                  id="amount"
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  className="input tnum"
                />
              </div>
              <div>
                <label className="label" htmlFor="expenseDate">
                  Date of expense
                </label>
                <input
                  id="expenseDate"
                  name="expenseDate"
                  type="date"
                  required
                  defaultValue={isoDate(tz)}
                  className="input"
                />
              </div>
              <div>
                <label className="label" htmlFor="description">
                  Description
                </label>
                <textarea id="description" name="description" rows={3} className="input" />
              </div>
            </GeoActionForm>
            <p className="help mt-3">
              Your coordinates are attached when available, which helps finance verify a
              field expense.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
