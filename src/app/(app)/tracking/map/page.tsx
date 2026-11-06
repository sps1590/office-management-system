import type { Metadata } from "next";
import Link from "next/link";
import { Gauge, Radio, Satellite, TriangleAlert } from "lucide-react";
import { requirePermission } from "@/lib/permissions";
import {
  listGeofenceEvents,
  listGeofences,
  livePositions,
  mapSites,
  trackingStats,
  userRoute,
} from "@/lib/tracking";
import OperationsMap from "@/components/OperationsMap";
import { Card, EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { formatTime, isoDate, num, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Live operations map" };

export default async function OperationsMapPage({
  searchParams,
}: {
  searchParams: Promise<{ route?: string; date?: string }>;
}) {
  const user = await requirePermission("tracking", "view");
  const tz = user.tenant.timezone;
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : isoDate(tz);

  const [people, fences, sites, stats, events, route] = await Promise.all([
    livePositions(user.tenant_id),
    listGeofences(user.tenant_id),
    mapSites(user.tenant_id),
    trackingStats(user.tenant_id, tz),
    listGeofenceEvents(user.tenant_id, 15),
    sp.route ? userRoute(user.tenant_id, sp.route, date) : Promise.resolve([]),
  ]);

  const routeOwner = people.find((p) => p.user_id === sp.route);

  return (
    <>
      <PageHeader
        title="Live operations map"
        description="Every active vehicle, delivery and field team. Positions come from the GPS telemetry engine and refresh every 60 seconds."
      >
        <Link href="/tracking" className="btn btn-secondary">
          <Gauge size={15} />
          Devices & geofences
        </Link>
      </PageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Reporting now"
          value={stats.live_now}
          sub="Last 15 minutes"
          icon={<Radio size={16} />}
          tone={stats.live_now > 0 ? "success" : "default"}
        />
        <KpiCard label="Active today" value={stats.active_today} />
        <KpiCard
          label="Coordinates logged today"
          value={num(stats.points_today)}
          icon={<Satellite size={16} />}
        />
        <KpiCard
          label="Deviations today"
          value={stats.deviations_today}
          icon={<TriangleAlert size={16} />}
          tone={stats.deviations_today > 0 ? "danger" : "success"}
        />
      </section>

      <div className="mt-4">
        {people.length === 0 && route.length === 0 && sites.warehouses.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<Satellite size={20} />}
              title="No positions yet"
              description="Nothing has reported a coordinate in the last two hours. Open the tracker on a phone, or enrol a mobile device, and positions will appear here."
              action={
                <Link href="/tracker" className="btn btn-primary">
                  Open the tracker
                </Link>
              }
            />
          </div>
        ) : (
          <OperationsMap
            people={people}
            fences={fences.filter((f) => f.is_active)}
            sites={[
              ...sites.warehouses.map((w) => ({ ...w, kind: "warehouse" as const })),
              ...sites.clients.map((c) => ({ ...c, kind: "client" as const })),
            ]}
            route={route}
            height={560}
            refreshSeconds={60}
          />
        )}
      </div>

      {sp.route && (
        <Card
          title={`Route playback — ${routeOwner?.full_name ?? "selected user"}, ${date}`}
          className="mt-4"
          action={
            <Link href="/tracking/map" className="btn btn-ghost btn-sm">
              Clear route
            </Link>
          }
        >
          {route.length === 0 ? (
            <p className="text-sm text-fg-subtle">
              No coordinates recorded for that person on this date.
            </p>
          ) : (
            <p className="text-sm text-fg-muted">
              {route.length} points from {formatTime(route[0].log_timestamp, tz)} to{" "}
              {formatTime(route[route.length - 1].log_timestamp, tz)}. Overlapping points
              within 25 m are collapsed so a parked vehicle does not hide the route.
            </p>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2 mt-4 items-start">
        <Card title="Who is on the map" bodyClassName="p-0">
          {people.length === 0 ? (
            <p className="px-5 py-5 text-sm text-fg-subtle">Nobody is reporting.</p>
          ) : (
            <div className="table-wrap max-h-96 overflow-y-auto scroll-thin">
              <table className="data">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>State</th>
                    <th className="right">Speed</th>
                    <th>Last report</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.user_id}>
                      <td>
                        <span className="block font-medium">{p.full_name}</span>
                        <span className="block text-xs text-fg-subtle">
                          {p.role_name ?? "—"}
                          {p.registration_number ? ` · ${p.registration_number}` : ""}
                        </span>
                      </td>
                      <td className="text-fg-muted">
                        {p.activity_state ?? "Unknown"}
                        {p.battery_percent != null && (
                          <span className="block text-xs text-fg-subtle">
                            battery {p.battery_percent}%
                          </span>
                        )}
                      </td>
                      <td className="right">
                        {p.speed_kph != null ? `${Math.round(p.speed_kph)} km/h` : "—"}
                      </td>
                      <td className="text-fg-muted text-xs">
                        {relativeTime(p.log_timestamp)}
                      </td>
                      <td>
                        <Link
                          href={`/tracking/map?route=${p.user_id}&date=${date}`}
                          className="btn btn-ghost btn-sm"
                        >
                          Route
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Recent geofence events" bodyClassName="p-0">
          {events.length === 0 ? (
            <p className="px-5 py-5 text-sm text-fg-subtle">
              No enter, exit or deviation events recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-border max-h-96 overflow-y-auto scroll-thin">
              {events.map((e) => (
                <li key={e.id} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span
                        className={
                          e.event_type === "deviation"
                            ? "badge badge-danger mr-2"
                            : e.event_type === "enter"
                              ? "badge badge-success mr-2"
                              : "badge badge-warning mr-2"
                        }
                      >
                        {e.event_type}
                      </span>
                      {e.full_name}
                    </p>
                    <p className="text-xs text-fg-subtle">
                      {e.geofence_name ?? "—"}
                      {e.distance_meters != null
                        ? ` · ${num(e.distance_meters, 0)} m from centre`
                        : ""}
                    </p>
                  </div>
                  <span className="text-xs text-fg-subtle shrink-0">
                    {relativeTime(e.occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
