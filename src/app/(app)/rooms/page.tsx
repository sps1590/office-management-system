import type { Metadata } from "next";
import { Building2, CalendarClock, CircleSlash } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { listRoomBookings, listRooms } from "@/lib/workplace";
import {
  bookRoomAction,
  cancelRoomBookingAction,
  createRoomAction,
} from "@/lib/actions/workplace";
import ActionButton from "@/components/ActionButton";
import AutoForm from "@/components/forms/AutoForm";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Meeting rooms" };

export default async function RoomsPage() {
  const user = await requirePermission("facilities", "view");
  const tz = user.tenant.timezone;

  const [rooms, bookings] = await Promise.all([
    listRooms(user.tenant_id),
    listRoomBookings(user.tenant_id),
  ]);

  const canCreate = hasPermission(user, "facilities", "create");
  const now = Date.now();
  const upcoming = bookings.filter(
    (b) => b.status === "confirmed" && new Date(b.end_time).getTime() > now
  );
  const inUseNow = bookings.filter(
    (b) =>
      b.status === "confirmed" &&
      new Date(b.start_time).getTime() <= now &&
      new Date(b.end_time).getTime() > now
  );

  return (
    <>
      <PageHeader
        title="Meeting rooms"
        description="Book a room by time slot. Overlapping bookings are refused, so the calendar cannot double-book."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Rooms" value={rooms.length} icon={<Building2 size={16} />} />
        <KpiCard
          label="Occupied right now"
          value={inUseNow.length}
          tone={inUseNow.length > 0 ? "info" : "success"}
        />
        <KpiCard label="Upcoming bookings" value={upcoming.length} icon={<CalendarClock size={16} />} />
        <KpiCard
          label="Total seats"
          value={rooms.reduce((s, r) => s + r.capacity, 0)}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          <Card title="Rooms" bodyClassName="p-0">
            {rooms.length === 0 ? (
              <EmptyState
                icon={<Building2 size={20} />}
                title="No rooms yet"
                description="Add a meeting room so it can be booked."
              />
            ) : (
              <ul className="divide-y divide-border">
                {rooms.map((r) => {
                  const busy = inUseNow.find((b) => b.room_id === r.id);
                  return (
                    <li key={r.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {r.name}
                          {r.code ? (
                            <span className="text-fg-subtle font-normal"> · {r.code}</span>
                          ) : null}
                        </p>
                        <p className="text-xs text-fg-subtle">
                          {[r.floor, `${r.capacity} seats`, ...(r.amenities ?? [])]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {busy ? (
                          <span className="badge badge-warning" title={busy.title}>
                            In use until {formatDateTime(busy.end_time, tz).split(", ")[1] ?? ""}
                          </span>
                        ) : (
                          <StatusBadge status={r.status} />
                        )}
                        <span className="badge badge-neutral">{r.upcoming} booked</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Bookings" bodyClassName="p-0">
            {bookings.length === 0 ? (
              <EmptyState
                icon={<CalendarClock size={20} />}
                title="Nothing booked"
                description="Use the form to reserve a room."
              />
            ) : (
              <div className="table-wrap max-h-[32rem] overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Meeting</th>
                      <th>Room</th>
                      <th>From</th>
                      <th>To</th>
                      <th className="right">People</th>
                      <th>Booked by</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <span className="block font-medium">{b.title}</span>
                          {b.purpose && (
                            <span className="block text-xs text-fg-subtle truncate max-w-48">
                              {b.purpose}
                            </span>
                          )}
                        </td>
                        <td className="text-fg-muted">{b.room_name}</td>
                        <td className="text-fg-muted text-xs">{formatDateTime(b.start_time, tz)}</td>
                        <td className="text-fg-muted text-xs">{formatDateTime(b.end_time, tz)}</td>
                        <td className="right">{b.attendee_count}</td>
                        <td className="text-fg-muted">{b.booked_by_name}</td>
                        <td>
                          <StatusBadge status={b.status} />
                        </td>
                        <td>
                          {b.status === "confirmed" &&
                            new Date(b.end_time).getTime() > now && (
                              <ActionButton
                                action={cancelRoomBookingAction}
                                values={{ bookingId: b.id }}
                                label="Cancel"
                                className="btn-ghost btn-sm"
                                confirm="Cancel this booking?"
                                icon={<CircleSlash size={13} />}
                              />
                            )}
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
          {rooms.length > 0 && (
            <Card title="Book a room">
              <AutoForm
                action={bookRoomAction}
                columns={1}
                submitLabel="Book room"
                resetOnSuccess
                fields={[
                  {
                    name: "roomId",
                    label: "Room",
                    type: "select",
                    required: true,
                    options: rooms
                      .filter((r) => r.status === "available")
                      .map((r) => ({
                        value: r.id,
                        label: `${r.name} — ${r.capacity} seats`,
                      })),
                  },
                  { name: "title", label: "Meeting title", required: true },
                  { name: "startTime", label: "From", type: "datetime-local", required: true },
                  { name: "endTime", label: "To", type: "datetime-local", required: true },
                  { name: "attendeeCount", label: "Attendees", type: "number", min: 1, defaultValue: 1 },
                  { name: "purpose", label: "Purpose", type: "textarea", rows: 2 },
                ]}
              />
            </Card>
          )}

          {canCreate && (
            <Card title="Add a room">
              <AutoForm
                action={createRoomAction}
                columns={1}
                compact
                resetOnSuccess
                submitLabel="Add room"
                fields={[
                  { name: "name", label: "Name", required: true, placeholder: "Boardroom" },
                  { name: "code", label: "Code" },
                  { name: "floor", label: "Floor" },
                  { name: "capacity", label: "Seats", type: "number", min: 0, defaultValue: 0 },
                  {
                    name: "amenities",
                    label: "Amenities",
                    placeholder: "Projector, whiteboard, VC",
                    help: "Comma separated.",
                  },
                ]}
              />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
