import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, ClipboardList, Flag, Play, X } from "lucide-react";
import { canSeeEveryone, hasPermission, requirePermission } from "@/lib/permissions";
import { bookingStats, listBookings, listDrivers, listVehicles } from "@/lib/fleet";
import {
  completeTripAction,
  createBookingAction,
  decideBookingAction,
  startTripAction,
} from "@/lib/actions/fleet";
import ActionButton from "@/components/ActionButton";
import AutoForm from "@/components/forms/AutoForm";
import FilterBar from "@/components/FilterBar";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime, money, num } from "@/lib/utils";

export const metadata: Metadata = { title: "Vehicle requisitions" };

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requirePermission("fleet", "view");
  const sp = await searchParams;

  const seesAll = canSeeEveryone(user, "fleet");
  const canApprove = hasPermission(user, "fleet", "approve");
  const currency = user.tenant.currency;

  const [bookings, stats, vehicles, drivers] = await Promise.all([
    listBookings(user.tenant_id, {
      status: sp.status,
      userId: seesAll ? undefined : user.id,
    }),
    seesAll ? bookingStats(user.tenant_id) : null,
    listVehicles(user.tenant_id),
    listDrivers(user.tenant_id),
  ]);

  const pending = bookings.filter((b) => b.status === "pending");
  const mine = bookings.filter(
    (b) =>
      (b.status === "approved" || b.status === "in_progress") &&
      (b.driver_id === user.id || b.requester_name === user.full_name)
  );

  return (
    <>
      <Link href="/fleet" className="btn btn-ghost btn-sm mb-4">
        <ArrowLeft size={15} />
        Fleet
      </Link>

      <PageHeader
        title="Vehicle requisitions"
        description="Request a vehicle, get it approved, then log the trip's odometer and fuel on return."
      />

      {stats && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Awaiting approval"
            value={stats.pending}
            icon={<ClipboardList size={16} />}
            tone={stats.pending > 0 ? "warning" : "success"}
          />
          <KpiCard label="Approved, not started" value={stats.approved} tone="info" />
          <KpiCard label="On the road now" value={stats.in_progress} tone="info" />
          <KpiCard label="Completed this month" value={stats.completed_this_month} />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          {canApprove && pending.length > 0 && (
            <Card title="Awaiting your approval" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {pending.map((b) => (
                  <li key={b.id} className="p-5 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {b.registration_number} · {b.purpose}
                      </p>
                      <p className="text-sm text-fg-muted">
                        {b.requester_name} · {b.destination ?? "No destination given"} ·{" "}
                        {b.passengers} passenger{b.passengers === 1 ? "" : "s"}
                      </p>
                      <p className="text-xs text-fg-subtle mt-1">
                        {formatDateTime(b.start_time)} → {formatDateTime(b.end_time)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <ActionButton
                        action={decideBookingAction}
                        values={{ bookingId: b.id, decision: "approved" }}
                        label="Approve"
                        className="btn-primary btn-sm"
                        icon={<Check size={14} />}
                      />
                      <ActionButton
                        action={decideBookingAction}
                        values={{ bookingId: b.id, decision: "rejected" }}
                        label="Decline"
                        className="btn-secondary btn-sm"
                        confirm="Decline this requisition?"
                        icon={<X size={14} />}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {mine.length > 0 && (
            <Card title="Your trips" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {mine.map((b) => (
                  <li key={b.id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {b.registration_number} · {b.purpose}
                        </p>
                        <p className="text-xs text-fg-subtle mt-0.5">
                          {formatDateTime(b.start_time)} → {formatDateTime(b.end_time)}
                        </p>
                      </div>
                      <StatusBadge status={b.status} />
                    </div>

                    {b.status === "approved" ? (
                      <div className="mt-3 max-w-sm">
                        <AutoForm
                          action={startTripAction}
                          hidden={{ bookingId: b.id }}
                          columns={1}
                          compact
                          submitLabel="Start trip"
                          pendingLabel="Starting…"
                          fields={[
                            {
                              name: "startOdometer",
                              label: "Opening odometer (km)",
                              type: "number",
                              min: 0,
                              defaultValue: b.start_odometer ?? "",
                              help: "Leave blank to use the vehicle's recorded reading.",
                            },
                          ]}
                        />
                      </div>
                    ) : (
                      <div className="mt-3">
                        <p className="text-[0.8125rem] font-semibold mb-2 flex items-center gap-1.5">
                          <Flag size={14} />
                          Close this trip
                        </p>
                        <AutoForm
                          action={completeTripAction}
                          hidden={{ bookingId: b.id }}
                          columns={2}
                          compact
                          submitLabel="Complete trip"
                          fields={[
                            {
                              name: "endOdometer",
                              label: "Closing odometer (km)",
                              type: "number",
                              required: true,
                              min: b.start_odometer ?? 0,
                              help: `Opened at ${num(b.start_odometer ?? 0)} km`,
                            },
                            { name: "fuelLitres", label: "Fuel (litres)", type: "number", min: 0, step: "0.01", defaultValue: 0 },
                            { name: "fuelCost", label: `Fuel cost (${currency})`, type: "number", min: 0, step: "0.01", defaultValue: 0 },
                            { name: "tollCost", label: `Tolls (${currency})`, type: "number", min: 0, step: "0.01", defaultValue: 0 },
                            { name: "notes", label: "Notes", type: "textarea", rows: 2, span: 2 },
                          ]}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={seesAll ? "All requisitions" : "My requisitions"} bodyClassName="p-0">
            <FilterBar
              filters={[
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  value: sp.status,
                  options: [
                    "pending",
                    "approved",
                    "in_progress",
                    "completed",
                    "rejected",
                    "cancelled",
                  ].map((s) => ({ value: s, label: s.replace(/_/g, " ") })),
                },
              ]}
            />
            {bookings.length === 0 ? (
              <EmptyState
                icon={<ClipboardList size={20} />}
                title="No requisitions"
                description="Request a vehicle using the form."
              />
            ) : (
              <div className="table-wrap max-h-[34rem] overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Vehicle</th>
                      <th>Purpose</th>
                      <th>Requested by</th>
                      <th>Period</th>
                      <th className="right">Distance</th>
                      <th className="right">Fuel</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr key={b.id}>
                        <td className="font-medium">{b.registration_number}</td>
                        <td className="text-fg-muted">
                          <span className="block truncate max-w-56">{b.purpose}</span>
                          {b.destination && (
                            <span className="block text-xs text-fg-subtle truncate max-w-56">
                              {b.destination}
                            </span>
                          )}
                        </td>
                        <td className="text-fg-muted">{b.requester_name}</td>
                        <td className="text-fg-muted text-xs">
                          {formatDateTime(b.start_time)}
                          <br />
                          {formatDateTime(b.end_time)}
                        </td>
                        <td className="right">
                          {b.distance_km != null ? `${num(b.distance_km, 1)} km` : "—"}
                        </td>
                        <td className="right">
                          {b.fuel_cost ? money(b.fuel_cost, currency) : "—"}
                        </td>
                        <td>
                          <StatusBadge status={b.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {hasPermission(user, "fleet", "create") && (
          <Card title="Request a vehicle">
            <AutoForm
              action={createBookingAction}
              columns={1}
              submitLabel="Submit requisition"
              resetOnSuccess
              fields={[
                {
                  name: "vehicleId",
                  label: "Vehicle",
                  type: "select",
                  required: true,
                  options: vehicles
                    .filter((v) => v.status !== "retired")
                    .map((v) => ({
                      value: v.id,
                      label: `${v.registration_number} — ${v.vehicle_type}${
                        v.status !== "available" ? ` (${v.status.replace(/_/g, " ")})` : ""
                      }`,
                    })),
                },
                {
                  name: "driverId",
                  label: "Driver",
                  type: "select",
                  options: drivers.map((d) => ({ value: d.id, label: d.full_name })),
                  help: "Leave blank to let the fleet manager assign one.",
                },
                { name: "purpose", label: "Purpose", required: true, placeholder: "Client visit, delivery…" },
                { name: "destination", label: "Destination" },
                { name: "startTime", label: "Departure", type: "datetime-local", required: true },
                { name: "endTime", label: "Expected return", type: "datetime-local", required: true },
                { name: "passengers", label: "Passengers", type: "number", min: 1, defaultValue: 1 },
              ]}
            />
            <p className="help mt-3">
              Overlapping bookings for the same vehicle are rejected, so the calendar
              cannot double-book.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
