"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, X } from "lucide-react";
import type { LeaveCalendarEntry } from "@/lib/types";
import { DAY_NAMES } from "@/lib/work-pattern";
import { Avatar, StatusBadge } from "@/components/ui";
import { addDays, cn, formatDate, num, weekdayOf } from "@/lib/utils";

/**
 * A month of absences, drawn as the faces of the people who are away.
 *
 * Every cell is a calendar day whether or not anybody is off, because the
 * question this screen answers is "who is away on the 12th" — which a list of
 * requests cannot answer without the reader doing the date arithmetic in
 * their head.
 *
 * A multi-day leave is expanded here rather than in SQL: the query returns one
 * row per request and the grid repeats the face across the span, so a
 * fortnight off costs one row on the wire instead of fourteen.
 *
 * Clicking a face opens the detail in a native `<dialog>`. Esc, focus
 * trapping and the backdrop all come from the browser, so the popover needs no
 * focus-management library — and no second round trip, because everything it
 * shows was joined on by `leaveCalendar`.
 */

/** How many faces fit in a cell before the rest collapse into a "+n". */
const FACES_PER_CELL = 3;

type View =
  | { kind: "day"; day: string }
  | { kind: "entry"; entry: LeaveCalendarEntry; backTo?: string };

export default function LeaveCalendar({
  entries,
  from,
  to,
  today,
  weekStart,
  weekendDays,
  holidays,
  timeZone,
  canOpenProfile,
}: {
  entries: LeaveCalendarEntry[];
  /** First and last calendar day of the month, as YYYY-MM-DD. */
  from: string;
  to: string;
  today: string;
  /** Weekday the grid begins on, 0 = Sunday. */
  weekStart: number;
  weekendDays: number[];
  holidays: { holiday_date: string; name: string }[];
  timeZone: string;
  /** True when the viewer may also open the employee's own record. */
  canOpenProfile?: boolean;
}) {
  const [view, setView] = useState<View | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  // showModal() cannot be called during render, and a <dialog> cannot be
  // opened declaratively, so the one imperative call is kept here.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (view && !el.open) el.showModal();
    else if (!view && el.open) el.close();
  }, [view]);

  const { days, byDay, holidayNames } = useMemo(() => {
    const byDay = new Map<string, LeaveCalendarEntry[]>();
    const days: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      days.push(d);
      byDay.set(d, []);
    }
    for (const e of entries) {
      // Clamp to the window: a leave from last month starts on the 1st here.
      const start = e.start_date < from ? from : e.start_date;
      const end = e.end_date > to ? to : e.end_date;
      for (let d = start; d <= end; d = addDays(d, 1)) byDay.get(d)?.push(e);
    }
    const holidayNames = new Map(holidays.map((h) => [h.holiday_date, h.name]));
    return { days, byDay, holidayNames };
  }, [entries, from, to, holidays]);

  // Blank cells before the 1st, so the 1st lands under its own weekday.
  const lead = (weekdayOf(from) - weekStart + 7) % 7;
  const columns = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);

  const peopleAway = new Set(entries.map((e) => e.user_id)).size;

  return (
    <>
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {columns.map((dow) => (
          <div
            key={dow}
            className={cn(
              "pb-1.5 text-center text-[0.6875rem] font-semibold uppercase tracking-wide",
              weekendDays.includes(dow) ? "text-fg-subtle" : "text-fg-muted"
            )}
          >
            <span className="hidden sm:inline">{DAY_NAMES[dow].slice(0, 3)}</span>
            {/* Two letters, not one: "S M T W T F S" has Sunday and Saturday
                reading alike, and Tuesday and Thursday too. */}
            <span className="sm:hidden">{DAY_NAMES[dow].slice(0, 2)}</span>
          </div>
        ))}

        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} aria-hidden />
        ))}

        {days.map((day) => {
          const on = byDay.get(day) ?? [];
          const rest = weekendDays.includes(weekdayOf(day));
          const holiday = holidayNames.get(day);
          const isToday = day === today;
          const shown = on.slice(0, FACES_PER_CELL);
          const hidden = on.length - shown.length;

          return (
            <div
              key={day}
              className={cn(
                "min-h-[4.75rem] rounded-lg border p-1.5 sm:min-h-[5.5rem] sm:p-2",
                holiday
                  ? "border-accent/40 bg-accent-soft"
                  : rest
                    ? "border-border/70 bg-surface-2"
                    : "border-border bg-surface",
                isToday && "ring-2 ring-primary/60"
              )}
            >
              <div className="flex items-baseline justify-between gap-1">
                <button
                  type="button"
                  onClick={() => on.length && setView({ kind: "day", day })}
                  disabled={on.length === 0}
                  aria-label={
                    on.length
                      ? `${formatDate(day, timeZone)}: ${on.length} on leave`
                      : formatDate(day, timeZone)
                  }
                  className={cn(
                    "tnum rounded text-xs font-semibold",
                    on.length > 0 && "hover:text-primary focus-visible:ring-2 focus-visible:ring-ring",
                    isToday ? "text-primary" : rest || holiday ? "text-fg-subtle" : "text-fg-muted"
                  )}
                >
                  {Number(day.slice(8, 10))}
                </button>
                {on.length > 0 && (
                  <span className="tnum text-[0.625rem] text-fg-subtle">{on.length}</span>
                )}
              </div>

              {holiday && (
                <p className="truncate text-[0.625rem] font-medium text-accent" title={holiday}>
                  {holiday}
                </p>
              )}

              <div className="mt-1 flex flex-wrap gap-1">
                {shown.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setView({ kind: "entry", entry: e, backTo: day })}
                    title={`${e.full_name} — ${e.leave_type}${
                      e.status === "pending" ? " (awaiting approval)" : ""
                    }`}
                    aria-label={`${e.full_name}, ${e.leave_type}${
                      e.status === "pending" ? ", awaiting approval" : ""
                    }`}
                    className={cn(
                      "relative rounded-full transition-transform hover:scale-110",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      e.status === "pending" && "opacity-60"
                    )}
                    // The ring carries the leave type's own colour, which is
                    // the only way a glance tells sick leave from annual.
                    style={{ boxShadow: `0 0 0 2px ${e.color}` }}
                  >
                    <Avatar name={e.full_name} url={e.avatar_url} size={22} />
                    {e.status === "pending" && (
                      <span
                        aria-hidden
                        className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-surface bg-warning"
                      />
                    )}
                  </button>
                ))}
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => setView({ kind: "day", day })}
                    className="grid h-[22px] min-w-[22px] place-items-center rounded-full bg-surface-hover px-1
                               text-[0.625rem] font-semibold text-fg-muted
                               hover:bg-primary-soft hover:text-primary
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${hidden} more on leave on ${formatDate(day, timeZone)}`}
                  >
                    +{hidden}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="help mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          {entries.length === 0
            ? "Nobody is booked off this month."
            : `${entries.length} request${entries.length === 1 ? "" : "s"} · ${peopleAway} ${
                peopleAway === 1 ? "person" : "people"
              }`}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="relative inline-block h-3 w-3 rounded-full bg-fg-subtle">
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full border border-surface bg-warning" />
          </span>
          Awaiting approval
        </span>
        <span>Ring colour is the leave category. Click a face for the detail.</span>
      </p>

      <dialog
        ref={dialog}
        className="sheet"
        onClose={() => setView(null)}
        // A click that lands on the dialog element itself is a backdrop click:
        // the content is all in children, so nothing else can be the target.
        onClick={(e) => {
          if (e.target === dialog.current) setView(null);
        }}
      >
        {view?.kind === "day" && (
          <DayDetail
            day={view.day}
            entries={byDay.get(view.day) ?? []}
            timeZone={timeZone}
            onPick={(entry) => setView({ kind: "entry", entry, backTo: view.day })}
            onClose={() => setView(null)}
          />
        )}
        {view?.kind === "entry" && (
          <EntryDetail
            entry={view.entry}
            timeZone={timeZone}
            canOpenProfile={canOpenProfile}
            onBack={view.backTo ? () => setView({ kind: "day", day: view.backTo! }) : undefined}
            onClose={() => setView(null)}
          />
        )}
      </dialog>
    </>
  );
}

function SheetHead({
  title,
  sub,
  onBack,
  onClose,
}: {
  title: string;
  sub?: string;
  onBack?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="card-head sticky top-0 z-10 bg-surface">
      <div className="flex min-w-0 items-center gap-2">
        {onBack && (
          <button type="button" onClick={onBack} className="btn btn-ghost btn-icon" aria-label="Back">
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="min-w-0">
          <h2 className="card-title truncate">{title}</h2>
          {sub && <p className="truncate text-xs text-fg-muted">{sub}</p>}
        </div>
      </div>
      <button type="button" onClick={onClose} className="btn btn-ghost btn-icon" aria-label="Close">
        <X size={16} />
      </button>
    </div>
  );
}

function DayDetail({
  day,
  entries,
  timeZone,
  onPick,
  onClose,
}: {
  day: string;
  entries: LeaveCalendarEntry[];
  timeZone: string;
  onPick: (entry: LeaveCalendarEntry) => void;
  onClose: () => void;
}) {
  return (
    <>
      <SheetHead
        title={formatDate(day, timeZone)}
        sub={`${entries.length} on leave`}
        onClose={onClose}
      />
      <ul className="divide-y divide-border">
        {entries.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onPick(e)}
              className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-hover
                         focus-visible:outline-none focus-visible:bg-surface-hover"
            >
              <Avatar name={e.full_name} url={e.avatar_url} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{e.full_name}</span>
                <span className="block truncate text-sm text-fg-muted">
                  {e.department ?? "No department"}
                  {e.designation ? ` · ${e.designation}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: e.color }} />
                <span className="text-sm text-fg-muted">{e.leave_type}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function EntryDetail({
  entry,
  timeZone,
  canOpenProfile,
  onBack,
  onClose,
}: {
  entry: LeaveCalendarEntry;
  timeZone: string;
  canOpenProfile?: boolean;
  onBack?: () => void;
  onClose: () => void;
}) {
  const e = entry;
  return (
    <>
      <SheetHead
        title={e.full_name}
        sub={e.designation ?? e.employee_code ?? undefined}
        onBack={onBack}
        onClose={onClose}
      />
      <div className="p-5">
        <div className="flex items-center gap-3.5">
          <Avatar name={e.full_name} url={e.avatar_url} size={56} />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: e.color }} />
              {e.leave_type}
              {!e.is_paid && <span className="badge badge-neutral">unpaid</span>}
            </p>
            <p className="mt-1 text-sm text-fg-muted">
              {formatDate(e.start_date, timeZone)} – {formatDate(e.end_date, timeZone)}
            </p>
            <div className="mt-1.5">
              <StatusBadge status={e.status} />
            </div>
          </div>
        </div>

        <dl className="mt-4 border-t border-border pt-1">
          <Row label="Days">{num(e.days, 1)}</Row>
          <Row label="Department">{e.department ?? "—"}</Row>
          <Row label="Employee code">{e.employee_code ?? "—"}</Row>
          {e.status === "pending" && (
            <Row label="Awaiting">
              {e.awaiting_name ?? "—"}
              <span className="text-fg-subtle">
                {" "}
                (stage {e.current_stage} of {e.total_stages})
              </span>
            </Row>
          )}
          <Row label="Reason">
            {e.reason ? <span className="italic">&ldquo;{e.reason}&rdquo;</span> : "—"}
          </Row>
        </dl>

        {canOpenProfile && (
          <Link
            href={`/employees/${e.user_id}`}
            className="btn btn-secondary btn-sm mt-4"
            onClick={onClose}
          >
            <ExternalLink size={14} />
            Open profile
          </Link>
        )}
      </div>
    </>
  );
}

/* A two-column row, matching the `Field` primitive. Duplicated rather than
   imported so the sheet can stay a client component without pulling the whole
   ui module's Link usage into it. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 text-sm text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm">{children}</dd>
    </div>
  );
}
