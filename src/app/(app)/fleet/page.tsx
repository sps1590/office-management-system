import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Plus, Trash2, Truck, Wrench } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { fleetCostTrend, fleetStats, listDrivers, listVehicles } from "@/lib/fleet";
import {
  createVehicleAction,
  deleteVehicleAction,
  setVehicleStatusAction,
  updateVehicleAction,
} from "@/lib/actions/fleet";
import ActionButton from "@/components/ActionButton";
import EditDialog from "@/components/forms/EditDialog";
import AutoForm from "@/components/forms/AutoForm";
import FilterBar from "@/components/FilterBar";
import { BarChart } from "@/components/charts";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { addDays, compact, formatDate, isoDate, num } from "@/lib/utils";

export const metadata: Metadata = { title: "Fleet" };

const VEHICLE_TYPES = ["car", "van", "pickup", "truck", "bus", "motorcycle", "forklift", "other"];
const FUEL_TYPES = ["petrol", "diesel", "octane", "cng", "lpg", "electric", "hybrid"];

export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string }>;
}) {
  const user = await requirePermission("fleet", "view");
  const tz = user.tenant.timezone;
  const sp = await searchParams;

  const [vehicles, stats, drivers, costs] = await Promise.all([
    listVehicles(user.tenant_id, { q: sp.q, status: sp.status, type: sp.type }),
    fleetStats(user.tenant_id, tz),
    hasPermission(user, "fleet", "create") ? listDrivers(user.tenant_id) : [],
    fleetCostTrend(user.tenant_id, tz),
  ]);

  const canCreate = hasPermission(user, "fleet", "create");
  const canEdit = hasPermission(user, "fleet", "edit");
  const currency = user.tenant.currency;

  // "Expiring" means within 30 days — the window in which renewal is
  // actionable. Expiry dates are calendar days, so they are compared as
  // strings against the company's own today.
  const today = isoDate(tz);
  const renewBy = addDays(today, 30);
  const expiring = vehicles.filter((v) => {
    const soon = (d: string | null) => d !== null && d < renewBy;
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
                          <ExpiryCell date={v.insurance_expiry} tz={tz} today={today} renewBy={renewBy} />
                        </td>
                        <td>
                          <ExpiryCell date={v.fitness_expiry} tz={tz} today={today} renewBy={renewBy} />
                        </td>
                        <td>
                          <StatusBadge status={v.status} />
                        </td>
                        {canEdit && (
                          <td>
                            <EditDialog
                              title={`Edit ${v.registration_number}`}
                              action={updateVehicleAction}
                              hidden={{ vehicleId: v.id }}
                              columns={2}
                              fields={[
                                {
                                  name: "registrationNumber",
                                  label: "Registration",
                                  required: true,
                                  defaultValue: v.registration_number,
                                },
                                { name: "make", label: "Make", defaultValue: v.make ?? "" },
                                { name: "model", label: "Model", defaultValue: v.model ?? "" },
                                {
                                  name: "year",
                                  label: "Year",
                                  type: "number",
                                  min: 1950,
                                  max: 2100,
                                  defaultValue: v.year ?? "",
                                },
                                {
                                  name: "vehicleType",
                                  label: "Type",
                                  type: "select",
                                  required: true,
                                  defaultValue: v.vehicle_type,
                                  options: [
                                    "car",
                                    "van",
                                    "pickup",
                                    "truck",
                                    "bus",
                                    "motorcycle",
                                    "forklift",
                                    "other",
                                  ].map((o) => ({ value: o, label: o })),
                                },
                                {
                                  name: "fuelType",
                                  label: "Fuel",
                                  type: "select",
                                  required: true,
                                  defaultValue: v.fuel_type,
                                  options: [
                                    "petrol",
                                    "diesel",
                                    "octane",
                                    "cng",
                                    "lpg",
                                    "electric",
                                    "hybrid",
                                  ].map((o) => ({ value: o, label: o })),
                                },
                                {
                                  name: "currentOdometer",
                                  label: "Odometer (km)",
                                  type: "number",
                                  min: 0,
                                  defaultValue: v.current_odometer,
                                  help: "Only ever moves forward; a lower figure is ignored.",
                                },
                                {
                                  name: "insuranceExpiry",
                                  label: "Insurance expires",
                                  type: "date",
                                  defaultValue: v.insurance_expiry ?? "",
                                },
                                {
                                  name: "fitnessExpiry",
                                  label: "Fitness expires",
                                  type: "date",
                                  defaultValue: v.fitness_expiry ?? "",
                                },
                                {
                                  name: "taxTokenExpiry",
                                  label: "Tax token expires",
                                  type: "date",
                                  defaultValue: v.tax_token_expiry ?? "",
                                },
                              ]}
                            />
                            <ActionButton
                              action={deleteVehicleAction}
                              values={{ id: v.id }}
                              label=""
                              title={`Delete ${v.registration_number}`}
                              className="btn-ghost btn-icon"
                              icon={<Trash2 size={14} />}
                              confirm={`Delete ${v.registration_number}? This only works while it has no bookings, trips or services.`}
                            />
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

function ExpiryCell({
  date,
  tz,
  today,
  renewBy,
}: {
  date: string | null;
  tz: string;
  today: string;
  renewBy: string;
}) {
  if (!date) return <span className="text-fg-subtle">—</span>;
  const expired = date < today;
  const soon = date < renewBy;
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
