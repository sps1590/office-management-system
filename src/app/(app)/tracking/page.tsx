import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Satellite, ShieldAlert, Smartphone, Trash2 } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import {
  listDevices,
  listGeofenceEvents,
  listGeofences,
  trackingStats,
} from "@/lib/tracking";
import { pickableUsers } from "@/lib/employees";
import { getSettings } from "@/lib/settings";
import {
  assignGeofenceAction,
  createGeofenceAction,
  purgeTelemetryAction,
  revokeDeviceAction,
  toggleGeofenceAction,
} from "@/lib/actions/tracking";
import ActionButton from "@/components/ActionButton";
import AutoForm from "@/components/forms/AutoForm";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime, num, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "GPS & geofences" };

export default async function TrackingPage() {
  const user = await requirePermission("tracking", "view");
  const tz = user.tenant.timezone;

  const [devices, fences, events, stats, people, settings] = await Promise.all([
    listDevices(user.tenant_id, tz),
    listGeofences(user.tenant_id),
    listGeofenceEvents(user.tenant_id, 30),
    trackingStats(user.tenant_id, tz),
    pickableUsers(user.tenant_id),
    getSettings(user.tenant_id),
  ]);

  const canCreate = hasPermission(user, "tracking", "create");
  const canEdit = hasPermission(user, "tracking", "edit");
  const canPurge = hasPermission(user, "tracking", "delete");

  return (
    <>
      <PageHeader
        title="GPS tracking & geofences"
        description={`Reporting every ${settings.telemetry_interval_seconds}s between ${settings.tracking_window_start.slice(0, 5)} and ${settings.tracking_window_end.slice(0, 5)}, retained for ${settings.telemetry_retention_days} days. Deviation threshold ${num(settings.deviation_threshold_meters)} m.`}
      >
        <Link href="/tracking/map" className="btn btn-secondary">
          <MapPin size={15} />
          Live map
        </Link>
        <Link href="/tracker" className="btn btn-primary">
          <Satellite size={15} />
          Open tracker
        </Link>
      </PageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Enrolled devices"
          value={stats.devices}
          sub={`${stats.mdm_devices} MDM managed`}
          icon={<Smartphone size={16} />}
        />
        <KpiCard label="Reporting now" value={stats.live_now} tone={stats.live_now ? "success" : "default"} />
        <KpiCard label="Coordinates today" value={num(stats.points_today)} />
        <KpiCard
          label="Active geofences"
          value={fences.filter((f) => f.is_active).length}
          sub={`${fences.filter((f) => f.assigned_count === 0).length} unassigned`}
          icon={<ShieldAlert size={16} />}
          tone={fences.some((f) => f.assigned_count === 0) ? "warning" : "default"}
        />
      </section>

      <div className="alert alert-info mt-4">
        <strong>Scope note.</strong> Continuous background tracking with no permission
        prompt requires a native app distributed through corporate MDM. The server side
        is complete — enrolment, batched ingest, geofencing and route reconstruction —
        and the tracker page works in a browser while it is open. See{" "}
        <code>docs/MOBILE.md</code> for the native client contract.
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          <Card title="Enrolled devices" bodyClassName="p-0">
            {devices.length === 0 ? (
              <EmptyState
                icon={<Smartphone size={20} />}
                title="No devices enrolled"
                description="A mobile client enrols once through the telemetry API; the tracker page enrols this browser."
                action={
                  <Link href="/tracker" className="btn btn-primary">
                    Enrol this browser
                  </Link>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Device</th>
                      <th>Platform</th>
                      <th className="right">Points today</th>
                      <th>Last seen</th>
                      <th>Status</th>
                      {canEdit && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((d) => (
                      <tr key={d.id}>
                        <td className="font-medium">{d.full_name}</td>
                        <td className="text-fg-muted">
                          <span className="block truncate max-w-48">{d.model ?? d.device_id}</span>
                          <span className="block text-xs text-fg-subtle">
                            every {d.interval_seconds}s
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-neutral capitalize">{d.platform}</span>
                          {d.mdm_enrolled && (
                            <span className="badge badge-primary ml-1">MDM</span>
                          )}
                        </td>
                        <td className="right">{num(d.points_today)}</td>
                        <td className="text-fg-muted text-xs">
                          {d.last_seen_at ? relativeTime(d.last_seen_at) : "Never"}
                        </td>
                        <td>
                          <StatusBadge status={d.is_active ? "active" : "inactive"} />
                        </td>
                        {canEdit && (
                          <td>
                            {d.is_active && (
                              <ActionButton
                                action={revokeDeviceAction}
                                values={{ deviceId: d.id }}
                                label="Revoke"
                                className="btn-ghost btn-sm"
                                confirm="Revoke this device's token? It stops reporting immediately."
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

          <Card title="Geofences" bodyClassName="p-0">
            {fences.length === 0 ? (
              <EmptyState
                icon={<ShieldAlert size={20} />}
                title="No geofences"
                description="Create one around the office to enable geo-fenced attendance, or around a sales territory to detect deviations."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Fence</th>
                      <th>Kind</th>
                      <th>Centre</th>
                      <th className="right">Radius</th>
                      <th className="right">Assigned</th>
                      <th>Alerts</th>
                      <th>Status</th>
                      {canEdit && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {fences.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-sm shrink-0"
                              style={{ background: f.color }}
                            />
                            <span className="font-medium">{f.name}</span>
                          </span>
                        </td>
                        <td className="text-fg-muted capitalize">{f.kind}</td>
                        <td className="text-fg-muted text-xs tnum">
                          {f.center_lat != null
                            ? `${f.center_lat.toFixed(4)}, ${f.center_lng?.toFixed(4)}`
                            : `${f.polygon?.length ?? 0}-point polygon`}
                        </td>
                        <td className="right">
                          {f.radius_meters ? `${num(f.radius_meters)} m` : "—"}
                        </td>
                        <td className="right">
                          {f.assigned_count === 0 ? (
                            <span className="badge badge-warning">none</span>
                          ) : (
                            f.assigned_count
                          )}
                        </td>
                        <td className="text-fg-muted text-xs">
                          {[f.alert_on_enter && "enter", f.alert_on_exit && "exit"]
                            .filter(Boolean)
                            .join(", ") || "deviation only"}
                        </td>
                        <td>
                          <StatusBadge status={f.is_active ? "active" : "inactive"} />
                        </td>
                        {canEdit && (
                          <td>
                            <ActionButton
                              action={toggleGeofenceAction}
                              values={{ geofenceId: f.id }}
                              label={f.is_active ? "Disable" : "Enable"}
                              className="btn-ghost btn-sm"
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Geofence event log" bodyClassName="p-0">
            {events.length === 0 ? (
              <p className="px-5 py-5 text-sm text-fg-subtle">No events recorded.</p>
            ) : (
              <div className="table-wrap max-h-80 overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Person</th>
                      <th>Fence</th>
                      <th>Event</th>
                      <th className="right">Distance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id}>
                        <td className="text-fg-muted text-xs">
                          {formatDateTime(e.occurred_at, tz)}
                        </td>
                        <td className="font-medium">{e.full_name}</td>
                        <td className="text-fg-muted">{e.geofence_name ?? "—"}</td>
                        <td>
                          <span
                            className={
                              e.event_type === "deviation"
                                ? "badge badge-danger"
                                : e.event_type === "enter"
                                  ? "badge badge-success"
                                  : "badge badge-warning"
                            }
                          >
                            {e.event_type}
                          </span>
                        </td>
                        <td className="right">
                          {e.distance_meters != null ? `${num(e.distance_meters, 0)} m` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="grid gap-4">
          {canCreate && (
            <Card title="Create a geofence">
              <AutoForm
                action={createGeofenceAction}
                columns={1}
                submitLabel="Create geofence"
                resetOnSuccess
                fields={[
                  { name: "name", label: "Name", required: true, placeholder: "Head office" },
                  {
                    name: "kind",
                    label: "Kind",
                    type: "select",
                    required: true,
                    defaultValue: "office",
                    options: [
                      "office",
                      "warehouse",
                      "territory",
                      "client",
                      "route",
                      "restricted",
                    ].map((k) => ({ value: k, label: k })),
                    help: "Office and warehouse fences also gate attendance check-in.",
                  },
                  {
                    name: "centerLat",
                    lngName: "centerLng",
                    radiusName: "radiusMeters",
                    label: "Centre",
                    type: "location",
                    required: true,
                    help: "Click the building on the map. The ring is the radius set below.",
                  },
                  {
                    name: "radiusMeters",
                    label: "Radius (metres)",
                    type: "number",
                    required: true,
                    min: 20,
                    defaultValue: 200,
                  },
                  { name: "alertOnEnter", label: "Alert managers on entry", type: "checkbox" },
                  { name: "alertOnExit", label: "Alert managers on exit", type: "checkbox" },
                ]}
              />
            </Card>
          )}

          {canEdit && fences.length > 0 && (
            <Card title="Assign a geofence">
              <p className="text-sm text-fg-muted mb-4">
                A fence only raises alerts for the people assigned to it.
              </p>
              <AutoForm
                action={assignGeofenceAction}
                columns={1}
                compact
                submitLabel="Assign"
                fields={[
                  {
                    name: "geofenceId",
                    label: "Geofence",
                    type: "select",
                    required: true,
                    options: fences.map((f) => ({ value: f.id, label: f.name })),
                  },
                  {
                    name: "userId",
                    label: "Employee",
                    type: "select",
                    required: true,
                    options: people.map((p) => ({ value: p.id, label: p.full_name })),
                  },
                ]}
              />
            </Card>
          )}

          {canPurge && (
            <Card title="Data governance">
              <p className="text-sm text-fg-muted mb-4">
                Telemetry older than the retention limit ({settings.telemetry_retention_days}{" "}
                days) can be removed. Employee location data is regulated in most
                jurisdictions — keep a retention limit and a written tracking policy.
              </p>
              <ActionButton
                action={purgeTelemetryAction}
                values={{}}
                label="Purge expired telemetry"
                className="btn-secondary"
                icon={<Trash2 size={15} />}
                confirm="Permanently delete location rows older than the retention limit?"
              />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
