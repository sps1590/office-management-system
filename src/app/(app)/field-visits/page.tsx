import type { Metadata } from "next";
import { BadgeCheck, MapPinOff, Navigation } from "lucide-react";
import { canSeeEveryone, hasPermission, requirePermission } from "@/lib/permissions";
import { clientOptions, listDeals, listFieldVisits, visitStats } from "@/lib/crm";
import { pickableUsers } from "@/lib/employees";
import { checkInVisitAction, checkOutVisitAction, planVisitAction } from "@/lib/actions/crm";
import AutoForm from "@/components/forms/AutoForm";
import FilterBar from "@/components/FilterBar";
import GeoActionForm from "@/components/GeoActionForm";
import { Avatar, Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime, num } from "@/lib/utils";

export const metadata: Metadata = { title: "Field visits" };

export default async function FieldVisitsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requirePermission("field", "view");
  const tz = user.tenant.timezone;
  const sp = await searchParams;

  const seesAll = canSeeEveryone(user, "field");
  const [visits, mine, stats, clients, deals, people] = await Promise.all([
    listFieldVisits(user.tenant_id, {
      status: sp.status,
      userId: seesAll ? undefined : user.id,
    }),
    listFieldVisits(user.tenant_id, { userId: user.id }),
    visitStats(user.tenant_id),
    clientOptions(user.tenant_id),
    listDeals(user.tenant_id, { status: "open" }),
    hasPermission(user, "field", "edit") ? pickableUsers(user.tenant_id) : [],
  ]);

  const myActive = mine.filter((v) => v.status === "planned" || v.status === "in_progress");

  return (
    <>
      <PageHeader
        title="Field visits"
        description="Checking in stamps your coordinates and compares them with the client's recorded address — the server decides whether the visit counts as verified."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Planned"
          value={stats.planned}
          icon={<Navigation size={16} />}
          tone={stats.planned > 0 ? "info" : "default"}
        />
        <KpiCard label="In progress" value={stats.in_progress} tone="info" />
        <KpiCard label="Completed this month" value={stats.completed_month} />
        <KpiCard
          label="Verified this month"
          value={`${stats.verified_month}/${stats.completed_month}`}
          sub="Within 500 m of the recorded address"
          icon={<BadgeCheck size={16} />}
          tone={
            stats.completed_month === 0
              ? "default"
              : stats.verified_month === stats.completed_month
                ? "success"
                : "warning"
          }
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          {myActive.length > 0 && (
            <Card title="Your visits today" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {myActive.map((v) => (
                  <li key={v.id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{v.purpose}</p>
                        <p className="text-sm text-fg-muted">
                          {v.client_name ?? "No client linked"}
                          {v.deal_title ? ` · ${v.deal_title}` : ""}
                        </p>
                        <p className="text-xs text-fg-subtle mt-0.5">
                          {v.planned_for
                            ? `Planned ${formatDateTime(v.planned_for, tz)}`
                            : "No time set"}
                          {v.checked_in_at
                            ? ` · checked in ${formatDateTime(v.checked_in_at, tz)}`
                            : ""}
                        </p>
                      </div>
                      <StatusBadge status={v.status} />
                    </div>

                    <div className="mt-3.5">
                      {v.status === "planned" ? (
                        <GeoActionForm
                          action={checkInVisitAction}
                          hidden={{ visitId: v.id }}
                          submitLabel="Check in at client"
                          pendingLabel="Recording…"
                        />
                      ) : (
                        <GeoActionForm
                          action={checkOutVisitAction}
                          hidden={{ visitId: v.id }}
                          submitLabel="Check out"
                          className="btn-secondary btn-sm"
                          required={false}
                        >
                          <div className="grid sm:grid-cols-2 gap-3">
                            <div>
                              <label className="label" htmlFor={`outcome-${v.id}`}>
                                Outcome
                              </label>
                              <input
                                id={`outcome-${v.id}`}
                                name="outcome"
                                className="input"
                                placeholder="Order placed, follow-up needed…"
                              />
                            </div>
                            <div>
                              <label className="label" htmlFor={`notes-${v.id}`}>
                                Notes
                              </label>
                              <input id={`notes-${v.id}`} name="notes" className="input" />
                            </div>
                          </div>
                        </GeoActionForm>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={seesAll ? "All field visits" : "My field visits"} bodyClassName="p-0">
            <FilterBar
              filters={[
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  value: sp.status,
                  options: ["planned", "in_progress", "completed", "missed", "cancelled"].map(
                    (s) => ({ value: s, label: s.replace(/_/g, " ") })
                  ),
                },
              ]}
            />
            {visits.length === 0 ? (
              <EmptyState
                icon={<Navigation size={20} />}
                title="No visits recorded"
                description="Plan a visit, then check in from the client's site."
              />
            ) : (
              <div className="table-wrap max-h-[34rem] overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Visit</th>
                      {seesAll && <th>Rep</th>}
                      <th>Client</th>
                      <th>Checked in</th>
                      <th>Outcome</th>
                      <th>Verification</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visits.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <span className="block font-medium truncate max-w-56">
                            {v.purpose}
                          </span>
                          {v.planned_for && (
                            <span className="block text-xs text-fg-subtle">
                              Planned {formatDateTime(v.planned_for, tz)}
                            </span>
                          )}
                        </td>
                        {seesAll && (
                          <td>
                            <span className="flex items-center gap-2">
                              <Avatar name={v.user_name} size={24} />
                              <span className="truncate">{v.user_name}</span>
                            </span>
                          </td>
                        )}
                        <td className="text-fg-muted">{v.client_name ?? "—"}</td>
                        <td className="text-fg-muted text-xs">
                          {v.checked_in_at ? formatDateTime(v.checked_in_at, tz) : "—"}
                        </td>
                        <td className="text-fg-muted">
                          <span className="block truncate max-w-48">{v.outcome ?? "—"}</span>
                        </td>
                        <td>
                          {v.checked_in_at == null ? (
                            <span className="text-fg-subtle text-xs">—</span>
                          ) : v.verification_distance_m == null ? (
                            <span className="badge badge-neutral" title="Client has no coordinates">
                              <MapPinOff size={11} />
                              No pin
                            </span>
                          ) : v.verified ? (
                            <span className="badge badge-success">
                              <BadgeCheck size={11} />
                              {num(v.verification_distance_m, 0)} m
                            </span>
                          ) : (
                            <span className="badge badge-warning">
                              {num(v.verification_distance_m, 0)} m away
                            </span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={v.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {hasPermission(user, "field", "create") && (
          <Card title="Plan a visit">
            <AutoForm
              action={planVisitAction}
              columns={1}
              submitLabel="Plan visit"
              resetOnSuccess
              fields={[
                { name: "purpose", label: "Purpose", required: true, placeholder: "Quarterly review, demo…" },
                {
                  name: "clientId",
                  label: "Client",
                  type: "select",
                  options: clients.map((c) => ({
                    value: c.id,
                    label: `${c.name}${c.latitude == null ? " (no coordinates)" : ""}`,
                  })),
                  help: "A client without coordinates cannot be verified on check-in.",
                },
                {
                  name: "dealId",
                  label: "Related deal",
                  type: "select",
                  options: deals.map((d) => ({ value: d.id, label: d.title })),
                },
                { name: "plannedFor", label: "Planned for", type: "datetime-local" },
                ...(people.length > 0
                  ? [
                      {
                        name: "userId",
                        label: "Assign to",
                        type: "select" as const,
                        options: people.map((p) => ({ value: p.id, label: p.full_name })),
                        help: "Defaults to you.",
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
        )}
      </div>
    </>
  );
}
