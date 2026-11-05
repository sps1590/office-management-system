import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, Wrench } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { listMaintenance, listVehicles } from "@/lib/fleet";
import { vendorOptions } from "@/lib/procurement";
import {
  completeMaintenanceAction,
  createMaintenanceAction,
} from "@/lib/actions/fleet";
import ActionButton from "@/components/ActionButton";
import AutoForm from "@/components/forms/AutoForm";
import FilterBar from "@/components/FilterBar";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, isoDate, money, num } from "@/lib/utils";

export const metadata: Metadata = { title: "Fleet maintenance" };

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requirePermission("fleet", "view");
  const sp = await searchParams;

  const [records, vehicles, vendors] = await Promise.all([
    listMaintenance(user.tenant_id, { status: sp.status }),
    listVehicles(user.tenant_id),
    vendorOptions(user.tenant_id),
  ]);

  const canCreate = hasPermission(user, "fleet", "create");
  const canEdit = hasPermission(user, "fleet", "edit");
  const currency = user.tenant.currency;
  const tz = user.tenant.timezone;

  const open = records.filter((r) => r.status !== "completed" && r.status !== "cancelled");
  const overdue = open.filter(
    (r) => r.scheduled_date && new Date(r.scheduled_date).getTime() < Date.now()
  );
  const spendThisYear = records
    .filter((r) => r.completed_date?.startsWith(isoDate(tz).slice(0, 4)))
    .reduce((s, r) => s + r.cost, 0);

  return (
    <>
      <Link href="/fleet" className="btn btn-ghost btn-sm mb-4">
        <ArrowLeft size={15} />
        Fleet
      </Link>

      <PageHeader
        title="Maintenance"
        description="Scheduled servicing and repairs. Completing a service posts its cost to the general ledger and returns the vehicle to service."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Open jobs" value={open.length} icon={<Wrench size={16} />} />
        <KpiCard
          label="Overdue"
          value={overdue.length}
          tone={overdue.length > 0 ? "danger" : "success"}
        />
        <KpiCard label="Completed records" value={records.length - open.length} />
        <KpiCard label="Spend this year" value={money(spendThisYear, currency)} />
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
                options: ["scheduled", "in_progress", "completed", "cancelled"].map((s) => ({
                  value: s,
                  label: s.replace(/_/g, " "),
                })),
              },
            ]}
          />
          {records.length === 0 ? (
            <EmptyState
              icon={<Wrench size={20} />}
              title="No maintenance recorded"
              description="Schedule a service to build a history and a renewal reminder."
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Service</th>
                    <th>Scheduled</th>
                    <th>Completed</th>
                    <th>Workshop</th>
                    <th className="right">Cost</th>
                    <th>Next due</th>
                    <th>Status</th>
                    {canEdit && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => {
                    const isOverdue =
                      r.status !== "completed" &&
                      r.scheduled_date &&
                      new Date(r.scheduled_date).getTime() < Date.now();
                    return (
                      <tr key={r.id}>
                        <td className="font-medium">{r.registration_number}</td>
                        <td>
                          <span className="block">{r.service_type}</span>
                          {r.description && (
                            <span className="block text-xs text-fg-subtle truncate max-w-56">
                              {r.description}
                            </span>
                          )}
                        </td>
                        <td className={isOverdue ? "text-danger font-medium" : "text-fg-muted"}>
                          {formatDate(r.scheduled_date, tz)}
                        </td>
                        <td className="text-fg-muted">{formatDate(r.completed_date, tz)}</td>
                        <td className="text-fg-muted">{r.vendor_name ?? "—"}</td>
                        <td className="right">{r.cost > 0 ? money(r.cost, currency) : "—"}</td>
                        <td className="text-fg-muted">
                          {r.next_due_date
                            ? formatDate(r.next_due_date, tz)
                            : r.next_due_odometer
                              ? `${num(r.next_due_odometer)} km`
                              : "—"}
                        </td>
                        <td>
                          <StatusBadge status={isOverdue ? "overdue" : r.status} />
                        </td>
                        {canEdit && (
                          <td>
                            {r.status !== "completed" && r.status !== "cancelled" && (
                              <ActionButton
                                action={completeMaintenanceAction}
                                values={{ maintenanceId: r.id, cost: String(r.cost) }}
                                label="Complete"
                                className="btn-ghost btn-sm"
                                icon={<Check size={14} />}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {canCreate && (
          <Card title="Schedule a service">
            <AutoForm
              action={createMaintenanceAction}
              columns={1}
              submitLabel="Schedule"
              resetOnSuccess
              fields={[
                {
                  name: "vehicleId",
                  label: "Vehicle",
                  type: "select",
                  required: true,
                  options: vehicles.map((v) => ({
                    value: v.id,
                    label: `${v.registration_number} — ${num(v.current_odometer)} km`,
                  })),
                },
                { name: "serviceType", label: "Service", required: true, placeholder: "Oil change, brake pads…" },
                { name: "description", label: "Details", type: "textarea", rows: 2 },
                { name: "scheduledDate", label: "Scheduled for", type: "date" },
                { name: "cost", label: `Estimated cost (${currency})`, type: "number", min: 0, step: "0.01", defaultValue: 0 },
                {
                  name: "vendorId",
                  label: "Workshop / vendor",
                  type: "select",
                  options: vendors.map((v) => ({ value: v.id, label: v.company_name })),
                },
                { name: "nextDueDate", label: "Next service due", type: "date" },
              ]}
            />
          </Card>
        )}
      </div>
    </>
  );
}
