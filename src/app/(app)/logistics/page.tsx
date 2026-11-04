import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Route, Truck } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import {
  listLogisticsRoutes,
  listPurchaseOrders,
  listWarehouses,
} from "@/lib/procurement";
import { listDrivers, listVehicles } from "@/lib/fleet";
import {
  createLogisticsRouteAction,
  setRouteStatusAction,
} from "@/lib/actions/procurement";
import ActionButton from "@/components/ActionButton";
import AutoForm from "@/components/forms/AutoForm";
import FilterBar from "@/components/FilterBar";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime, num } from "@/lib/utils";

export const metadata: Metadata = { title: "Logistics routes" };

export default async function LogisticsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requirePermission("logistics", "view");
  const sp = await searchParams;

  const [routes, vehicles, drivers, warehouses, orders] = await Promise.all([
    listLogisticsRoutes(user.tenant_id, { status: sp.status }),
    listVehicles(user.tenant_id),
    listDrivers(user.tenant_id),
    listWarehouses(user.tenant_id),
    listPurchaseOrders(user.tenant_id, { status: "approved" }),
  ]);

  const canCreate = hasPermission(user, "logistics", "create");
  const canEdit = hasPermission(user, "logistics", "edit");

  const inTransit = routes.filter((r) => r.status === "in_transit");
  const delayed = routes.filter((r) => r.status === "delayed");

  return (
    <>
      <PageHeader
        title="Logistics routes"
        description="Deliveries from warehouse to destination, tied to a vehicle and driver. Live positions come from the GPS engine."
      >
        {hasPermission(user, "tracking", "view") && (
          <Link href="/tracking/map" className="btn btn-secondary">
            <MapPin size={15} />
            Live map
          </Link>
        )}
      </PageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Routes planned" value={routes.length} icon={<Route size={16} />} />
        <KpiCard
          label="In transit now"
          value={inTransit.length}
          icon={<Truck size={16} />}
          tone={inTransit.length > 0 ? "info" : "default"}
        />
        <KpiCard
          label="Delayed"
          value={delayed.length}
          tone={delayed.length > 0 ? "danger" : "success"}
        />
        <KpiCard
          label="Delivered"
          value={routes.filter((r) => r.status === "delivered").length}
          tone="success"
        />
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
                options: ["planned", "in_transit", "delivered", "delayed", "cancelled"].map(
                  (s) => ({ value: s, label: s.replace(/_/g, " ") })
                ),
              },
            ]}
          />
          {routes.length === 0 ? (
            <EmptyState
              icon={<Route size={20} />}
              title="No routes planned"
              description="Plan a delivery to track goods from the warehouse to their destination."
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Vehicle / driver</th>
                    <th>Planned</th>
                    <th>Actual</th>
                    <th className="right">Distance</th>
                    <th>Status</th>
                    {canEdit && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {routes.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className="block font-medium">{r.destination ?? "—"}</span>
                        <span className="block text-xs text-fg-subtle">
                          {[r.origin_name, r.po_number, r.reference]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </span>
                      </td>
                      <td className="text-fg-muted">
                        <span className="block">{r.registration_number ?? "Unassigned"}</span>
                        <span className="block text-xs text-fg-subtle">
                          {r.driver_name ?? "No driver"}
                        </span>
                      </td>
                      <td className="text-fg-muted text-xs">
                        {r.planned_departure ? formatDateTime(r.planned_departure) : "—"}
                        <br />
                        {r.planned_arrival ? formatDateTime(r.planned_arrival) : ""}
                      </td>
                      <td className="text-fg-muted text-xs">
                        {r.actual_departure ? formatDateTime(r.actual_departure) : "—"}
                        <br />
                        {r.actual_arrival ? formatDateTime(r.actual_arrival) : ""}
                      </td>
                      <td className="right">
                        {r.distance_km != null ? `${num(r.distance_km, 1)} km` : "—"}
                      </td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      {canEdit && (
                        <td>
                          <span className="flex flex-wrap gap-1.5">
                            {r.status === "planned" && (
                              <ActionButton
                                action={setRouteStatusAction}
                                values={{ routeId: r.id, status: "in_transit" }}
                                label="Depart"
                                className="btn-ghost btn-sm"
                              />
                            )}
                            {r.status === "in_transit" && (
                              <>
                                <ActionButton
                                  action={setRouteStatusAction}
                                  values={{ routeId: r.id, status: "delivered" }}
                                  label="Delivered"
                                  className="btn-ghost btn-sm"
                                />
                                <ActionButton
                                  action={setRouteStatusAction}
                                  values={{ routeId: r.id, status: "delayed" }}
                                  label="Delayed"
                                  className="btn-ghost btn-sm"
                                />
                              </>
                            )}
                            {r.status === "delayed" && (
                              <ActionButton
                                action={setRouteStatusAction}
                                values={{ routeId: r.id, status: "delivered" }}
                                label="Delivered"
                                className="btn-ghost btn-sm"
                              />
                            )}
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {canCreate && (
          <Card title="Plan a delivery">
            <AutoForm
              action={createLogisticsRouteAction}
              columns={1}
              submitLabel="Plan route"
              resetOnSuccess
              fields={[
                { name: "destination", label: "Destination", required: true, placeholder: "Client site, branch…" },
                { name: "reference", label: "Reference" },
                {
                  name: "purchaseOrderId",
                  label: "Linked purchase order",
                  type: "select",
                  options: orders.map((o) => ({
                    value: o.id,
                    label: `${o.po_number} — ${o.vendor_name}`,
                  })),
                },
                {
                  name: "originWarehouseId",
                  label: "From warehouse",
                  type: "select",
                  options: warehouses.map((w) => ({ value: w.id, label: w.name })),
                },
                {
                  name: "assignedVehicleId",
                  label: "Vehicle",
                  type: "select",
                  options: vehicles
                    .filter((v) => v.status !== "retired")
                    .map((v) => ({ value: v.id, label: v.registration_number })),
                },
                {
                  name: "driverId",
                  label: "Driver",
                  type: "select",
                  options: drivers.map((d) => ({ value: d.id, label: d.full_name })),
                },
                { name: "plannedDeparture", label: "Planned departure", type: "datetime-local" },
                { name: "plannedArrival", label: "Planned arrival", type: "datetime-local" },
                {
                  name: "destinationLat",
                  label: "Destination latitude",
                  help: "Optional. Lets the map draw the delivery target and raise a deviation alert.",
                },
                { name: "destinationLng", label: "Destination longitude" },
                { name: "notes", label: "Notes", type: "textarea", rows: 2 },
              ]}
            />
          </Card>
        )}
      </div>
    </>
  );
}
