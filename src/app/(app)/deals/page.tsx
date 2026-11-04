import type { Metadata } from "next";
import { Handshake, TrendingUp, Trophy } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import {
  clientOptions,
  crmStats,
  dealActivities,
  listDeals,
  listStages,
  pipelineByStage,
} from "@/lib/crm";
import { pickableUsers } from "@/lib/employees";
import { createDealAction, logActivityAction } from "@/lib/actions/crm";
import AutoForm from "@/components/forms/AutoForm";
import StageSelect from "@/components/forms/StageSelect";
import { RowBars } from "@/components/charts";
import { Card, EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { compact, formatDate, money, percent, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Pipeline" };

export default async function DealsPage() {
  const user = await requirePermission("crm", "view");

  const [deals, stages, stats, funnel, clients, people, activities] = await Promise.all([
    listDeals(user.tenant_id),
    listStages(user.tenant_id),
    crmStats(user.tenant_id),
    pipelineByStage(user.tenant_id),
    clientOptions(user.tenant_id),
    pickableUsers(user.tenant_id),
    dealActivities(user.tenant_id, 12),
  ]);

  const canCreate = hasPermission(user, "crm", "create");
  const canEdit = hasPermission(user, "crm", "edit");
  const currency = user.tenant.currency;

  const openStages = stages.filter((s) => !s.is_won && !s.is_lost);
  const winRate = percent(stats.won_count, stats.won_count + stats.lost_count);
  // Weighted forecast: each open deal counted at its stage probability.
  const forecast = deals
    .filter((d) => d.status === "open")
    .reduce((s, d) => s + d.value * ((d.probability ?? 0) / 100), 0);

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Deals by stage. Moving a deal into a won or lost stage closes it automatically."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Open pipeline"
          value={`${currency} ${compact(stats.open_value)}`}
          sub={`${stats.open_deals} open deals`}
          icon={<Handshake size={16} />}
        />
        <KpiCard
          label="Weighted forecast"
          value={`${currency} ${compact(forecast)}`}
          sub="Each deal at its stage probability"
          icon={<TrendingUp size={16} />}
        />
        <KpiCard
          label="Won this month"
          value={`${currency} ${compact(stats.won_month)}`}
          sub={`${currency} ${compact(stats.won_year)} this year`}
          icon={<Trophy size={16} />}
          tone="success"
        />
        <KpiCard
          label="Win rate"
          value={`${winRate}%`}
          sub={`${stats.won_count} won · ${stats.lost_count} lost`}
          tone={winRate >= 50 ? "success" : winRate > 0 ? "warning" : "default"}
        />
      </section>

      {/* Kanban. Horizontal scroll keeps every stage reachable on a phone
          without collapsing the board into a list. */}
      <div className="mt-4 overflow-x-auto scroll-thin pb-2">
        <div className="flex gap-4 min-w-max">
          {openStages.map((stage) => {
            const cards = deals.filter(
              (d) => d.stage_id === stage.id && d.status === "open"
            );
            const columnValue = cards.reduce((s, d) => s + d.value, 0);
            return (
              <section key={stage.id} className="w-72 shrink-0">
                <header className="flex items-center justify-between gap-2 mb-2.5 px-1">
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{ background: stage.color }}
                    />
                    <span className="text-sm font-semibold truncate">{stage.name}</span>
                    <span className="badge badge-neutral shrink-0">{cards.length}</span>
                  </span>
                  <span className="text-xs text-fg-subtle tnum shrink-0">
                    {compact(columnValue)}
                  </span>
                </header>

                <div className="space-y-2.5">
                  {cards.length === 0 ? (
                    <p className="panel px-3 py-6 text-center text-xs text-fg-subtle">
                      Nothing in this stage
                    </p>
                  ) : (
                    cards.map((d) => (
                      <article key={d.id} className="card card-hover p-3.5">
                        <p className="text-sm font-medium leading-snug">{d.title}</p>
                        <p className="mt-1 text-xs text-fg-subtle truncate">
                          {d.client_name ?? "No client"}
                          {d.owner_name ? ` · ${d.owner_name}` : ""}
                        </p>
                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          <span className="font-semibold tnum text-sm">
                            {money(d.value, currency)}
                          </span>
                          <span className="text-xs text-fg-subtle">
                            {d.probability ?? 0}%
                          </span>
                        </div>
                        {d.expected_close_date && (
                          <p className="mt-1 text-xs text-fg-subtle">
                            Closes {formatDate(d.expected_close_date)}
                          </p>
                        )}
                        {canEdit && (
                          <div className="mt-2.5">
                            <StageSelect
                              dealId={d.id}
                              stageId={d.stage_id}
                              stages={stages.map((s) => ({ id: s.id, name: s.name }))}
                            />
                          </div>
                        )}
                      </article>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          <Card title="Open value by stage">
            <RowBars
              data={funnel.map((f) => ({ label: f.label, value: f.value }))}
              colors={funnel.map((f) => f.color)}
              format={(n) => money(n, currency)}
            />
          </Card>

          <Card title="Closed deals" bodyClassName="p-0">
            {deals.filter((d) => d.status !== "open").length === 0 ? (
              <p className="px-5 py-5 text-sm text-fg-subtle">Nothing closed yet.</p>
            ) : (
              <div className="table-wrap max-h-80 overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Deal</th>
                      <th>Client</th>
                      <th>Owner</th>
                      <th className="right">Value</th>
                      <th>Closed</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deals
                      .filter((d) => d.status !== "open")
                      .map((d) => (
                        <tr key={d.id}>
                          <td className="font-medium">{d.title}</td>
                          <td className="text-fg-muted">{d.client_name ?? "—"}</td>
                          <td className="text-fg-muted">{d.owner_name ?? "—"}</td>
                          <td className="right">{money(d.value, currency)}</td>
                          <td className="text-fg-muted">{formatDate(d.closed_at)}</td>
                          <td>
                            <span
                              className={
                                d.status === "won" ? "badge badge-success" : "badge badge-danger"
                              }
                            >
                              {d.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Recent activity" bodyClassName="p-0">
            {activities.length === 0 ? (
              <p className="px-5 py-5 text-sm text-fg-subtle">No activity logged yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {activities.map((a) => (
                  <li key={a.id} className="px-5 py-3 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="badge badge-neutral mr-2">{a.activity_type}</span>
                        {a.subject ?? a.body ?? "—"}
                      </p>
                      <p className="text-xs text-fg-subtle mt-0.5">
                        {[a.client_name, a.deal_title, a.user_name].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <span className="text-xs text-fg-subtle shrink-0">
                      {relativeTime(a.occurred_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {canCreate && (
          <div className="grid gap-4">
            <Card title="Add a deal">
              <AutoForm
                action={createDealAction}
                columns={1}
                submitLabel="Add to pipeline"
                resetOnSuccess
                fields={[
                  { name: "title", label: "Deal name", required: true },
                  {
                    name: "clientId",
                    label: "Client",
                    type: "select",
                    options: clients.map((c) => ({ value: c.id, label: c.name })),
                  },
                  { name: "value", label: `Value (${currency})`, type: "number", min: 0, step: "0.01", defaultValue: 0 },
                  {
                    name: "stageId",
                    label: "Stage",
                    type: "select",
                    required: true,
                    defaultValue: openStages[0]?.id,
                    options: stages.map((s) => ({ value: s.id, label: s.name })),
                  },
                  { name: "leadSource", label: "Lead source" },
                  {
                    name: "ownerId",
                    label: "Owner",
                    type: "select",
                    options: people.map((p) => ({ value: p.id, label: p.full_name })),
                    help: "Defaults to you.",
                  },
                  { name: "expectedCloseDate", label: "Expected close", type: "date" },
                  { name: "description", label: "Notes", type: "textarea", rows: 2 },
                ]}
              />
            </Card>

            <Card title="Log an activity">
              <AutoForm
                action={logActivityAction}
                columns={1}
                compact
                resetOnSuccess
                submitLabel="Log activity"
                fields={[
                  {
                    name: "activityType",
                    label: "Type",
                    type: "select",
                    required: true,
                    defaultValue: "call",
                    options: ["call", "email", "meeting", "note", "demo", "proposal"].map(
                      (t) => ({ value: t, label: t })
                    ),
                  },
                  {
                    name: "clientId",
                    label: "Client",
                    type: "select",
                    options: clients.map((c) => ({ value: c.id, label: c.name })),
                  },
                  {
                    name: "dealId",
                    label: "Deal",
                    type: "select",
                    options: deals
                      .filter((d) => d.status === "open")
                      .map((d) => ({ value: d.id, label: d.title })),
                  },
                  { name: "subject", label: "Subject" },
                  { name: "body", label: "Detail", type: "textarea", rows: 2 },
                ]}
              />
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
