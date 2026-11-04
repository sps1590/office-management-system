import type { Metadata } from "next";
import { LogOut, UserCheck, Users } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { listVisitors } from "@/lib/workplace";
import { pickableUsers } from "@/lib/employees";
import { checkOutVisitorAction, logVisitorAction } from "@/lib/actions/workplace";
import ActionButton from "@/components/ActionButton";
import AutoForm from "@/components/forms/AutoForm";
import { Card, EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Visitors" };

export default async function VisitorsPage() {
  const user = await requirePermission("facilities", "view");

  const [visitors, hosts] = await Promise.all([
    listVisitors(user.tenant_id),
    pickableUsers(user.tenant_id),
  ]);

  const canCreate = hasPermission(user, "facilities", "create");
  const canEdit = hasPermission(user, "facilities", "edit");
  const inside = visitors.filter((v) => !v.checked_out_at);
  const today = visitors.filter(
    (v) => new Date(v.checked_in_at).toDateString() === new Date().toDateString()
  );

  return (
    <>
      <PageHeader
        title="Visitor log"
        description="Reception register. The host is notified the moment their visitor is checked in."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Currently on site"
          value={inside.length}
          icon={<UserCheck size={16} />}
          tone={inside.length > 0 ? "info" : "default"}
        />
        <KpiCard label="Checked in today" value={today.length} icon={<Users size={16} />} />
        <KpiCard label="Total records" value={visitors.length} />
        <KpiCard
          label="Not checked out"
          value={inside.length}
          sub={inside.length > 0 ? "Follow up before closing reception" : "Register is clear"}
          tone={inside.length > 0 ? "warning" : "success"}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          {inside.length > 0 && (
            <Card title="On site now" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {inside.map((v) => (
                  <li key={v.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {v.full_name}
                        {v.company ? (
                          <span className="font-normal text-fg-muted"> · {v.company}</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-fg-subtle">
                        Badge {v.badge_number ?? "—"} · host {v.host_name ?? "—"} · in{" "}
                        {relativeTime(v.checked_in_at)}
                        {v.vehicle_number ? ` · vehicle ${v.vehicle_number}` : ""}
                      </p>
                    </div>
                    {canEdit && (
                      <ActionButton
                        action={checkOutVisitorAction}
                        values={{ visitorId: v.id }}
                        label="Check out"
                        className="btn-secondary btn-sm"
                        icon={<LogOut size={13} />}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Visitor history" bodyClassName="p-0">
            {visitors.length === 0 ? (
              <EmptyState
                icon={<Users size={20} />}
                title="No visitors recorded"
                description="Check in a visitor to start the register."
              />
            ) : (
              <div className="table-wrap max-h-[34rem] overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Visitor</th>
                      <th>Company</th>
                      <th>Host</th>
                      <th>Purpose</th>
                      <th>In</th>
                      <th>Out</th>
                      <th>Badge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visitors.map((v) => (
                      <tr key={v.id}>
                        <td className="font-medium">{v.full_name}</td>
                        <td className="text-fg-muted">{v.company ?? "—"}</td>
                        <td className="text-fg-muted">{v.host_name ?? "—"}</td>
                        <td className="text-fg-muted">
                          <span className="block truncate max-w-48">{v.purpose ?? "—"}</span>
                        </td>
                        <td className="text-fg-muted text-xs">
                          {formatDateTime(v.checked_in_at)}
                        </td>
                        <td className="text-fg-muted text-xs">
                          {v.checked_out_at ? (
                            formatDateTime(v.checked_out_at)
                          ) : (
                            <span className="badge badge-info">On site</span>
                          )}
                        </td>
                        <td className="text-fg-muted">{v.badge_number ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {canCreate && (
          <Card title="Check in a visitor">
            <AutoForm
              action={logVisitorAction}
              columns={1}
              submitLabel="Check in"
              resetOnSuccess
              fields={[
                { name: "fullName", label: "Visitor name", required: true },
                { name: "company", label: "Company" },
                { name: "phone", label: "Phone", type: "tel" },
                {
                  name: "hostUserId",
                  label: "Host",
                  type: "select",
                  options: hosts.map((h) => ({ value: h.id, label: h.full_name })),
                  help: "The host gets an in-app notification immediately.",
                },
                { name: "purpose", label: "Purpose of visit" },
                { name: "vehicleNumber", label: "Vehicle number" },
              ]}
            />
            <p className="help mt-3">A badge number is generated automatically.</p>
          </Card>
        )}
      </div>
    </>
  );
}
