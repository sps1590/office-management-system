import type { Metadata } from "next";
import { BookOpen, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import {
  incomeStatement,
  listAccounts,
  recentJournal,
  trialBalance,
} from "@/lib/ledger";
import { cashFlowTrend, financeStats } from "@/lib/finance";
import { createJournalEntryAction } from "@/lib/actions/finance";
import AutoForm from "@/components/forms/AutoForm";
import { AreaChart, DonutChart } from "@/components/charts";
import { Card, EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { compact, formatDate, isoDate, money, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "General ledger" };

export default async function FinancePage() {
  const user = await requirePermission("finance", "view");
  const currency = user.tenant.currency;

  const year = new Date().getFullYear();
  const [balance, journal, accounts, pnl, stats, cash] = await Promise.all([
    trialBalance(user.tenant_id),
    recentJournal(user.tenant_id, 30),
    listAccounts(user.tenant_id),
    incomeStatement(user.tenant_id, `${year}-01-01`, isoDate()),
    financeStats(user.tenant_id),
    cashFlowTrend(user.tenant_id, 6),
  ]);

  const totalDebit = balance.reduce((s, a) => s + a.debit, 0);
  const totalCredit = balance.reduce((s, a) => s + a.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  // Asset accounts are debit-natured, so the net debit is the balance.
  const cashBalance = balance
    .filter((a) => a.type === "asset")
    .reduce((s, a) => s + a.debit - a.credit, 0);

  const byType = ["asset", "liability", "equity", "income", "expense"].map((type) => ({
    label: titleCase(type),
    value: Math.abs(
      balance
        .filter((a) => a.type === type)
        .reduce((s, a) => s + (type === "income" ? a.credit - a.debit : a.debit - a.credit), 0)
    ),
  }));

  return (
    <>
      <PageHeader
        title="General ledger"
        description={`Double-entry journal for ${year}. Payroll, purchase receipts, invoices, payments, trip costs and expense claims all post here automatically.`}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={`Revenue, ${year}`}
          value={`${currency} ${compact(pnl.income)}`}
          icon={<TrendingUp size={16} />}
          tone="success"
        />
        <KpiCard
          label={`Expenses, ${year}`}
          value={`${currency} ${compact(pnl.expense)}`}
          icon={<TrendingDown size={16} />}
        />
        <KpiCard
          label={`Profit, ${year}`}
          value={`${currency} ${compact(pnl.profit)}`}
          tone={pnl.profit >= 0 ? "success" : "danger"}
        />
        <KpiCard
          label="Trial balance"
          value={balanced ? "Balanced" : "Out of balance"}
          sub={`${money(totalDebit, currency)} debits · ${money(totalCredit, currency)} credits`}
          icon={<Scale size={16} />}
          tone={balanced ? "success" : "danger"}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3 mt-4">
        <Card title="Cash movement, last 6 months" className="lg:col-span-2">
          <AreaChart
            data={cash.map((c) => ({ label: c.label, value: c.inflow - c.outflow }))}
            height={200}
            format={(n) => compact(n)}
          />
          <p className="help mt-2">
            Net of recorded receipts and disbursements. Asset balance from the ledger:{" "}
            {money(cashBalance, currency)}.
          </p>
        </Card>

        <Card title="Balance by account type">
          <DonutChart
            data={byType}
            centerValue={compact(stats.receivable.outstanding)}
            centerLabel="receivable"
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          <Card title="Trial balance" bodyClassName="p-0">
            <div className="table-wrap max-h-96 overflow-y-auto scroll-thin">
              <table className="data">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Account</th>
                    <th>Type</th>
                    <th className="right">Debit</th>
                    <th className="right">Credit</th>
                    <th className="right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {balance.map((a) => (
                    <tr key={a.id}>
                      <td className="tnum text-fg-muted">{a.code}</td>
                      <td className="font-medium">{a.name}</td>
                      <td className="text-fg-muted capitalize">{a.type}</td>
                      <td className="right">{a.debit ? money(a.debit, currency) : "—"}</td>
                      <td className="right">{a.credit ? money(a.credit, currency) : "—"}</td>
                      <td className="right font-semibold">
                        {money(Math.abs(a.debit - a.credit), currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td colSpan={3}>Totals</td>
                    <td className="right">{money(totalDebit, currency)}</td>
                    <td className="right">{money(totalCredit, currency)}</td>
                    <td className="right">{balanced ? "✓" : "⚠"}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card title="Recent journal entries" bodyClassName="p-0">
            {journal.length === 0 ? (
              <EmptyState
                icon={<BookOpen size={20} />}
                title="Nothing posted yet"
                description="Entries appear here as the modules record money movements."
              />
            ) : (
              <div className="table-wrap max-h-96 overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Source</th>
                      <th className="right">Amount</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journal.map((e) => (
                      <tr key={e.id}>
                        <td className="text-fg-muted">{formatDate(e.entry_date)}</td>
                        <td className="font-medium">{e.description}</td>
                        <td>
                          <span className="badge badge-neutral">
                            {e.source.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="right">{money(e.amount, currency)}</td>
                        <td className="text-fg-muted">{e.created_by_name ?? "System"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="grid gap-4">
          <Card title={`Profit and loss, ${year}`}>
            <dl className="space-y-2 text-sm">
              {pnl.lines
                .filter((l) => Math.abs(l.net) > 0.005)
                .map((l) => (
                  <div key={l.code} className="flex justify-between gap-3">
                    <dt className="text-fg-muted truncate">{l.name}</dt>
                    <dd className="tnum shrink-0">
                      {money(l.type === "income" ? l.net : -l.net, currency)}
                    </dd>
                  </div>
                ))}
              {pnl.lines.length === 0 && (
                <p className="text-fg-subtle">No income or expense posted yet this year.</p>
              )}
            </dl>
            <dl className="mt-4 pt-3 border-t border-border space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-fg-muted">Total revenue</dt>
                <dd className="tnum">{money(pnl.income, currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-muted">Total expenses</dt>
                <dd className="tnum">{money(pnl.expense, currency)}</dd>
              </div>
              <div className="flex justify-between font-semibold pt-2 border-t border-border">
                <dt>Net profit</dt>
                <dd className="tnum">{money(pnl.profit, currency)}</dd>
              </div>
            </dl>
          </Card>

          {hasPermission(user, "finance", "create") && (
            <Card title="Manual journal entry">
              <AutoForm
                action={createJournalEntryAction}
                columns={1}
                submitLabel="Post entry"
                resetOnSuccess
                fields={[
                  { name: "entryDate", label: "Date", type: "date", required: true, defaultValue: isoDate() },
                  { name: "description", label: "Description", required: true },
                  { name: "amount", label: `Amount (${currency})`, type: "number", required: true, min: 0, step: "0.01" },
                  {
                    name: "debitAccountId",
                    label: "Debit account",
                    type: "select",
                    required: true,
                    options: accounts.map((a) => ({
                      value: a.id,
                      label: `${a.code} — ${a.name}`,
                    })),
                  },
                  {
                    name: "creditAccountId",
                    label: "Credit account",
                    type: "select",
                    required: true,
                    options: accounts.map((a) => ({
                      value: a.id,
                      label: `${a.code} — ${a.name}`,
                    })),
                  },
                  { name: "memo", label: "Memo" },
                ]}
              />
            </Card>
          )}

          <Card title="Chart of accounts" bodyClassName="p-0">
            <ul className="divide-y divide-border max-h-80 overflow-y-auto scroll-thin">
              {accounts.map((a) => (
                <li key={a.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm truncate">{a.name}</span>
                    <span className="block text-xs text-fg-subtle">
                      {a.code} · {a.type}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
