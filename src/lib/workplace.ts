import "server-only";
import { getDb } from "./db";
import { getSettings } from "./settings";

/* --- rooms ---------------------------------------------------------------- */

export async function listRooms(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT r.id, r.name, r.code, r.floor, r.capacity, r.amenities, r.status,
           (SELECT COUNT(*)::int FROM room_bookings b
             WHERE b.room_id = r.id AND b.tenant_id = ${tenantId}
               AND b.status = 'confirmed' AND b.end_time > now()) AS upcoming
      FROM rooms r
     WHERE r.tenant_id = ${tenantId}
     ORDER BY r.name
  `;
  return rows as unknown as {
    id: string;
    name: string;
    code: string | null;
    floor: string | null;
    capacity: number;
    amenities: string[];
    status: string;
    upcoming: number;
  }[];
}

export async function listRoomBookings(
  tenantId: string,
  filters: { from?: string; roomId?: string } = {}
) {
  const db = await getDb();
  const rows = await db`
    SELECT b.id, b.room_id, b.title, b.purpose, b.start_time, b.end_time,
           b.attendee_count, b.status,
           r.name AS room_name, u.full_name AS booked_by_name
      FROM room_bookings b
      JOIN rooms r ON r.id = b.room_id
      JOIN users u ON u.id = b.booked_by
     WHERE b.tenant_id = ${tenantId}
       AND (${filters.roomId ?? null}::uuid IS NULL OR b.room_id = ${filters.roomId ?? null}::uuid)
       AND b.end_time >= COALESCE(${filters.from ?? null}::timestamptz, now() - INTERVAL '7 days')
     ORDER BY b.start_time
     LIMIT 200
  `;
  return rows as unknown as {
    id: string;
    room_id: string;
    title: string;
    purpose: string | null;
    start_time: string;
    end_time: string;
    attendee_count: number;
    status: string;
    room_name: string;
    booked_by_name: string;
  }[];
}

/* --- free-slot search ------------------------------------------------------
   A refused booking is only half an answer; the useful half is when the room
   IS free. Bookings are written from `datetime-local` inputs, which carry no
   zone, so the wall clock someone typed is what lands in the column. Every
   calculation below therefore reads and writes UTC components, which keeps a
   suggested slot round-tripping back into the form as exactly the clock time
   its label names.
   -------------------------------------------------------------------------- */

export type FreeSlot = {
  /** "10:20–10:50", or "Mon 09 Nov, 09:00–09:30" when it is another day. */
  label: string;
  /** `datetime-local` values, ready to drop straight back into the form. */
  start: string;
  end: string;
};

const SEARCH_DAYS = 7;
const MIN_SLOT_MINUTES = 15;
const DAY_MS = 86_400_000;

const dayText = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});
const timeText = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

/** Reads a stored or typed timestamp as a wall clock, without shifting it. */
function wallClock(value: string | Date): Date {
  if (value instanceof Date) return value;
  const text = value.replace(" ", "T");
  return new Date(/(Z|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text}Z`);
}

const startOfDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Names a time range, adding the date only when it is not `sameDayAs`. */
export function slotLabel(
  start: string | Date,
  end: string | Date,
  sameDayAs: string | Date
): string {
  const a = wallClock(start);
  const b = wallClock(end);
  const range = `${timeText.format(a)}–${timeText.format(b)}`;
  return startOfDay(a).getTime() === startOfDay(wallClock(sameDayAs)).getTime()
    ? range
    : `${dayText.format(a)}, ${range}`;
}

/**
 * The next few windows in which one room is free for as long as was asked
 * for, so a refused booking offers somewhere to go instead of a dead end.
 *
 * The search runs over the company's working hours, widened on the requested
 * day itself so an after-hours request is answered after hours rather than
 * told to come back at nine, and skips the configured weekend on later days.
 * One suggestion comes out of each gap — its earliest start, since a meeting
 * that can begin the moment the room empties is the one people want.
 */
export async function findFreeSlots(
  tenantId: string,
  roomId: string,
  wantedStart: string,
  wantedEnd: string,
  limit = 3
): Promise<FreeSlot[]> {
  const from = wallClock(wantedStart);
  const to = wallClock(wantedEnd);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];

  const duration = Math.max(
    to.getTime() - from.getTime(),
    MIN_SLOT_MINUTES * 60_000
  );
  const firstDay = startOfDay(from);
  const horizon = new Date(firstDay.getTime() + SEARCH_DAYS * DAY_MS);

  const db = await getDb();
  const [settings, rows] = await Promise.all([
    getSettings(tenantId),
    db`
      SELECT start_time, end_time
        FROM room_bookings
       WHERE tenant_id = ${tenantId} AND room_id = ${roomId}
         AND status = 'confirmed'
         AND end_time > ${firstDay.toISOString()}
         AND start_time < ${horizon.toISOString()}
       ORDER BY start_time
    `,
  ]);

  const busy = (rows as unknown as { start_time: string; end_time: string }[]).map(
    (r) => ({
      start: wallClock(r.start_time).getTime(),
      end: wallClock(r.end_time).getTime(),
    })
  );

  const [h, m] = settings.work_start_time.split(":").map(Number);
  const opensAt = ((h || 0) * 60 + (m || 0)) * 60_000;
  const closesAt = Math.min(
    opensAt + settings.standard_work_minutes * 60_000,
    DAY_MS
  );
  // 0 = Sunday, the JS day numbering the weekend_days default [5, 6] —
  // Friday and Saturday — was written against.
  const weekend = new Set(settings.weekend_days ?? []);
  // Rounded up so a slot offered "from now" starts on a whole minute, which
  // is all a datetime-local input can carry anyway.
  const now = Math.ceil(Date.now() / 60_000) * 60_000;

  const slots: FreeSlot[] = [];
  const offer = (start: number) => {
    const a = new Date(start);
    const b = new Date(start + duration);
    slots.push({
      label: slotLabel(a, b, from),
      start: a.toISOString().slice(0, 16),
      end: b.toISOString().slice(0, 16),
    });
  };

  for (let i = 0; i < SEARCH_DAYS && slots.length < limit; i++) {
    const day = new Date(firstDay.getTime() + i * DAY_MS);
    if (i > 0 && weekend.has(day.getUTCDay())) continue;

    let open = day.getTime() + opensAt;
    let close = day.getTime() + closesAt;
    if (i === 0) {
      open = Math.min(open, from.getTime());
      close = Math.max(close, to.getTime());
    }

    let cursor = Math.max(open, now);
    for (const b of busy) {
      if (b.end <= cursor) continue;
      if (b.start >= close) break;
      if (b.start - cursor >= duration) {
        offer(cursor);
        if (slots.length >= limit) break;
      }
      cursor = Math.max(cursor, b.end);
    }
    if (slots.length < limit && close - cursor >= duration) offer(cursor);
  }

  return slots;
}

/* --- visitors ------------------------------------------------------------- */

export async function listVisitors(tenantId: string, onlyInside = false) {
  const db = await getDb();
  const rows = await db`
    SELECT v.id, v.full_name, v.company, v.phone, v.purpose, v.badge_number,
           v.vehicle_number, v.checked_in_at, v.checked_out_at,
           h.full_name AS host_name
      FROM visitors v
      LEFT JOIN users h ON h.id = v.host_user_id
     WHERE v.tenant_id = ${tenantId}
       AND (${onlyInside}::boolean = FALSE OR v.checked_out_at IS NULL)
     ORDER BY v.checked_in_at DESC
     LIMIT 200
  `;
  return rows as unknown as {
    id: string;
    full_name: string;
    company: string | null;
    phone: string | null;
    purpose: string | null;
    badge_number: string | null;
    vehicle_number: string | null;
    checked_in_at: string;
    checked_out_at: string | null;
    host_name: string | null;
  }[];
}

/* --- assets --------------------------------------------------------------- */

export async function listAssets(
  tenantId: string,
  filters: { q?: string; status?: string } = {}
) {
  const db = await getDb();
  const q = filters.q?.trim() ? `%${filters.q.trim()}%` : null;
  const rows = await db`
    SELECT a.id, a.asset_tag, a.name, a.category, a.serial_number, a.assigned_to,
           a.purchase_date, a.purchase_cost::float AS purchase_cost,
           a.current_value::float AS current_value, a.warranty_expiry,
           a.condition, a.status, a.location,
           u.full_name AS assigned_to_name, d.name AS department_name
      FROM assets a
      LEFT JOIN users u       ON u.id = a.assigned_to
      LEFT JOIN departments d ON d.id = a.department_id
     WHERE a.tenant_id = ${tenantId}
       AND (${q}::text IS NULL OR a.name ILIKE ${q} OR a.asset_tag ILIKE ${q}
            OR a.category ILIKE ${q} OR a.serial_number ILIKE ${q})
       AND (${filters.status ?? null}::text IS NULL OR a.status = ${filters.status ?? null})
     ORDER BY a.name
  `;
  return rows as unknown as {
    id: string;
    asset_tag: string;
    name: string;
    category: string | null;
    serial_number: string | null;
    assigned_to: string | null;
    purchase_date: string | null;
    purchase_cost: number | null;
    current_value: number | null;
    warranty_expiry: string | null;
    condition: string;
    status: string;
    location: string | null;
    assigned_to_name: string | null;
    department_name: string | null;
  }[];
}

export async function assetStats(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT COUNT(*)::int                                          AS total,
           COUNT(*) FILTER (WHERE status = 'in_use')::int          AS in_use,
           COUNT(*) FILTER (WHERE status = 'under_repair')::int    AS under_repair,
           COUNT(*) FILTER (WHERE warranty_expiry IS NOT NULL
                              AND warranty_expiry < CURRENT_DATE + 60)::int AS warranty_due,
           COALESCE(SUM(COALESCE(current_value, purchase_cost, 0)), 0)::float AS book_value
      FROM assets WHERE tenant_id = ${tenantId}
  `;
  return rows[0] as {
    total: number;
    in_use: number;
    under_repair: number;
    warranty_due: number;
    book_value: number;
  };
}

/* --- tasks and projects --------------------------------------------------- */

export type Task = {
  id: string;
  project_id: string | null;
  project_name: string | null;
  title: string;
  description: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
  created_by_name: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  completed_lat: number | null;
  completed_lng: number | null;
  comment_count: number;
};

export async function listTasks(
  tenantId: string,
  filters: { assignedTo?: string; status?: string; projectId?: string; q?: string } = {}
): Promise<Task[]> {
  const db = await getDb();
  const q = filters.q?.trim() ? `%${filters.q.trim()}%` : null;
  const rows = await db`
    SELECT t.id, t.project_id, t.title, t.description, t.assigned_to, t.priority,
           t.status, t.due_date, t.completed_at,
           t.completed_lat::float AS completed_lat,
           t.completed_lng::float AS completed_lng,
           p.name AS project_name,
           a.full_name AS assignee_name,
           c.full_name AS created_by_name,
           (SELECT COUNT(*)::int FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users a    ON a.id = t.assigned_to
      LEFT JOIN users c    ON c.id = t.created_by
     WHERE t.tenant_id = ${tenantId}
       AND (${filters.assignedTo ?? null}::uuid IS NULL OR t.assigned_to = ${filters.assignedTo ?? null}::uuid)
       AND (${filters.status ?? null}::text IS NULL OR t.status = ${filters.status ?? null})
       AND (${filters.projectId ?? null}::uuid IS NULL OR t.project_id = ${filters.projectId ?? null}::uuid)
       AND (${q}::text IS NULL OR t.title ILIKE ${q} OR t.description ILIKE ${q})
     ORDER BY
       CASE t.status WHEN 'in_progress' THEN 0 WHEN 'review' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END,
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       (t.due_date IS NULL), t.due_date
     LIMIT 300
  `;
  return rows as unknown as Task[];
}

export async function taskStats(tenantId: string, userId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT COUNT(*) FILTER (WHERE status NOT IN ('done','cancelled'))::int AS open,
           COUNT(*) FILTER (WHERE status NOT IN ('done','cancelled')
                              AND due_date < CURRENT_DATE)::int            AS overdue,
           COUNT(*) FILTER (WHERE assigned_to = ${userId}
                              AND status NOT IN ('done','cancelled'))::int AS mine,
           COUNT(*) FILTER (WHERE status = 'done'
                              AND completed_at >= date_trunc('week', CURRENT_DATE))::int AS done_this_week
      FROM tasks WHERE tenant_id = ${tenantId}
  `;
  return rows[0] as { open: number; overdue: number; mine: number; done_this_week: number };
}

export async function listProjects(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT p.id, p.name, p.code, p.status, p.start_date, p.end_date,
           o.full_name AS owner_name,
           (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id) AS task_count,
           (SELECT COUNT(*)::int FROM tasks t
             WHERE t.project_id = p.id AND t.status = 'done') AS done_count
      FROM projects p
      LEFT JOIN users o ON o.id = p.owner_id
     WHERE p.tenant_id = ${tenantId}
     ORDER BY p.name
  `;
  return rows as unknown as {
    id: string;
    name: string;
    code: string | null;
    status: string;
    start_date: string | null;
    end_date: string | null;
    owner_name: string | null;
    task_count: number;
    done_count: number;
  }[];
}

export async function taskComments(tenantId: string, taskId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT c.id, c.body, c.created_at, u.full_name
      FROM task_comments c
      LEFT JOIN users u ON u.id = c.user_id
     WHERE c.tenant_id = ${tenantId} AND c.task_id = ${taskId}
     ORDER BY c.created_at
  `;
  return rows as unknown as {
    id: string;
    body: string;
    created_at: string;
    full_name: string | null;
  }[];
}
