import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Plus, Truck, Wrench } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { fleetCostTrend, fleetStats, listDrivers, listVehicles } from "@/lib/fleet";
import { createVehicleAction, setVehicleStatusAction } from "@/lib/actions/fleet";
import ActionButton from "@/components/ActionButton";
import AutoForm from "@/components/forms/AutoForm";
import FilterBar from "@/components/FilterBar";
import { BarChart } from "@/components/charts";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { compact, formatDate, num } from "@/lib/utils";

export const metadata: Metadata = { title: "Fleet" };

const VEHICLE_TYPES = ["car", "van", "pickup", "truck", "bus", "motorcycle", "forklift", "other"];
const FUEL_TYPES = ["petrol", "diesel", "octane", "cng", "lpg", "electric", "hybrid"];

export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string }>;
}) {
  const user = await requirePermission("fleet", "view");
  const sp = await searchParams;

  const [vehicles, stats, drivers, costs] = await Promise.all([
    listVehicles(user.tenant_id, { q: sp.q, status: sp.status, type: sp.type }),
    fleetStats(user.tenant_id),
    hasPermission(user, "fleet", "create") ? listDrivers(user.tenant_id) : [],
    fleetCostTrend(user.tenant_id),
  ]);

  const canCreate = hasPermission(user, "fleet", "create");
  const canEdit = hasPermission(user, "fleet", "edit");
  const currency = user.tenant.currency;
  const tz = user.tenant.timezone;

  // "Expiring" means within 30 days — the window in which renewal is actionable.
  const expiring = vehicles.filter((v) => {
    const soon = (d: string | null) =>
      d && new Date(d).getTime() < Date.now() + 30 * 86_400_000;
    return soon(v.insurance_expiry) || soon(v.fitness_expiry) || soon(v.tax_token_expiry);
  });

  return (
    <>
      <PageHeader
        title="Fleet"
        description="Vehicle registry, driver assignment and document expiry."
      >
        <Link href="/fleet/bookings" className="btn btn-secondary">
          Requisitions
        </Link>
        <Link href="/fleet/maintenance" className="btn btn-secondary">
          <Wrench size={15} />
          Maintenance
        </Link>
      </PageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Vehicles" value={stats.total} icon={<Truck size={16} />} />
        <KpiCard label="Available" value={stats.available} tone="success" />
        <KpiCard
          label="In use"
          value={stats.in_use}
          sub={`${stats.maintenance} in maintenance`}
          tone="info"
        />
        <KpiCard
          label="Documents expiring"
          value={stats.insurance_due + stats.fitness_due}
          sub="Insurance or fitness within 30 days"
          icon={<AlertTriangle size={16} />}
          tone={stats.insurance_due + stats.fitness_due > 0 ? "danger" : "success"}
        />
      </section>

      {expiring.length > 0 && (
        <div className="alert alert-warning mt-4">
          <strong>Renewal due:</strong>{" "}
          {expiring
            .map((v) => v.registration_number)
            .slice(0, 6)
            .join(", ")}
          {expiring.length > 6 && ` and ${expiring.length - 6} more`}. Check the document
          columns below.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          <Card bodyClassName="p-0">
            <FilterBar
              filters={[
                { name: "q", label: "Search", type: "search", value: sp.q, placeholder: "Registration, make, model" },
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  value: sp.status,
                  options: ["available", "in_use", "maintenance", "retired"].map((s) => ({
                    value: s,
                    label: s.replace(/_/g, " "),
                  })),
                },
                {
                  name: "type",
                  label: "Type",
                  type: "select",
                  value: sp.type,
                  options: VEHICLE_TYPES.map((t) => ({ value: t, label: t })),
                },
              ]}
            />
            {vehicles.length === 0 ? (
              <EmptyState
                icon={<Truck size={20} />}
                title="No vehicles yet"
                description="Add the first vehicle to start tracking requisitions, trips and maintenance."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Vehicle</th>
                      <th>Type</th>
                      <th>Driver</th>
                      <th className="right">Odometer</th>
                      <th>Insurance</th>
                      <th>Fitness</th>
                      <th>Status</th>
                      {canEdit && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <span className="block font-medium">{v.registration_number}</span>
                          <span className="block text-xs text-fg-subtle">
                            {[v.make, v.model, v.year].filter(Boolean).join(" ") || "—"}
                          </span>
                        </td>
                        <td className="text-fg-muted capitalize">
                          {v.vehicle_type} · {v.fuel_type}
                        </td>
                        <td className="text-fg-muted">{v.driver_name ?? "—"}</td>
                        <td className="right">{num(v.current_odometer)} km</td>
                        <td>
                          <ExpiryCell date={v.insurance_expiry} tz={tz} />
                        </td>
                        <td>
                          <ExpiryCell date={v.fitness_expiry} tz={tz} />
                        </td>
                        <td>
                          <StatusBadge status={v.status} />
                        </td>
                        {canEdit && (
                          <td>
                            {v.status !== "maintenance" ? (
                              <ActionButton
                                action={setVehicleStatusAction}
                                values={{ vehicleId: v.id, status: "maintenance" }}
                                label="To workshop"
                                className="btn-ghost btn-sm"
                              />
                            ) : (
                              <ActionButton
                                action={setVehicleStatusAction}
                                values={{ vehicleId: v.id, status: "available" }}
                                label="Back in service"
                                className="btn-ghost btn-sm"
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={`Running cost, last 6 months (${currency})`}>
            <BarChart
              data={costs.map((c) => ({
                label: c.label,
                value: c.trips + c.maintenance,
              }))}
              height={190}
              format={(n) => compact(n)}
            />
            <p className="help mt-2">
              Fuel, tolls and other trip costs plus completed maintenance, taken from
              closed trip logs and service records.
            </p>
          </Card>
        </div>

        {canCreate && (
          <Card title="Add a vehicle">
            <AutoForm
              action={createVehicleAction}
              columns={1}
              submitLabel="Add vehicle"
              resetOnSuccess
              fields={[
                { name: "registrationNumber", label: "Registration number", required: true, placeholder: "DHA-GA-11-2345" },
                { name: "make", label: "Make", placeholder: "Toyota" },
                { name: "model", label: "Model", placeholder: "Hiace" },
                { name: "year", label: "Year", type: "number", min: 1950, max: 2100 },
                {
                  name: "vehicleType",
                  label: "Type",
                  type: "select",
                  required: true,
                  defaultValue: "car",
                  options: VEHICLE_TYPES.map((t) => ({ value: t, label: t })),
                },
                {
                  name: "fuelType",
                  label: "Fuel",
                  type: "select",
                  required: true,
                  defaultValue: "diesel",
                  options: FUEL_TYPES.map((t) => ({ value: t, label: t })),
                },
                { name: "seatingCapacity", label: "Seats", type: "number", min: 1 },
                { name: "currentOdometer", label: "Odometer (km)", type: "number", min: 0, defaultValue: 0 },
                {
                  name: "assignedDriverId",
                  label: "Assigned driver",
                  type: "select",
                  options: drivers.map((d) => ({ value: d.id, label: d.full_name })),
                },
                { name: "insuranceExpiry", label: "Insurance expiry", type: "date" },
                { name: "fitnessExpiry", label: "Fitness expiry", type: "date" },
                { name: "taxTokenExpiry", label: "Tax token expiry", type: "date" },
                { name: "notes", label: "Notes", type: "textarea", rows: 2 },
              ]}
            />
          </Card>
        )}
      </div>
    </>
  );
}

function ExpiryCell({ date, tz }: { date: string | null; tz: string }) {
  if (!date) return <span className="text-fg-subtle">—</span>;
  const time = new Date(date).getTime();
  const expired = time < Date.now();
  const soon = time < Date.now() + 30 * 86_400_000;
  return (
    <span
      className={
        expired
          ? "badge badge-danger"
          : soon
            ? "badge badge-warning"
            : "text-fg-muted text-sm"
      }
    >
      {formatDate(date, tz)}
    </span>
  );
}
