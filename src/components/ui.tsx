import Link from "next/link";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
   Server-safe UI primitives shared by every module page. None of these use
   hooks, so they render on the server and cost nothing in the client bundle.
   --------------------------------------------------------------------------- */

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-fg-muted max-w-2xl">{description}</p>
        )}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = "default",
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  href?: string;
}) {
  const toneColor = {
    default: "text-primary bg-primary-soft",
    success: "text-success bg-success-soft",
    warning: "text-warning bg-warning-soft",
    danger: "text-danger bg-danger-soft",
    info: "text-info bg-info-soft",
  }[tone];

  const body = (
    <div className="card card-hover p-5 h-full">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8125rem] font-medium text-fg-muted">{label}</p>
        {icon && (
          <span className={cn("grid place-items-center h-8 w-8 rounded-lg shrink-0", toneColor)}>
            {icon}
          </span>
        )}
      </div>
      <p className="kpi-value mt-2.5">{value}</p>
      {sub && <p className="mt-1 text-xs text-fg-subtle">{sub}</p>}
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Card({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("card overflow-hidden", className)}>
      {title && (
        <div className="card-head">
          <h2 className="card-title">{title}</h2>
          {action}
        </div>
      )}
      <div className={cn(bodyClassName ?? "p-5")}>{children}</div>
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-14 px-6">
      {icon && (
        <div className="mx-auto mb-4 grid place-items-center h-12 w-12 rounded-xl bg-surface-hover text-fg-subtle">
          {icon}
        </div>
      )}
      <p className="font-semibold tracking-tight">{title}</p>
      {description && (
        <p className="mt-1.5 text-sm text-fg-muted max-w-sm mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/* --- status badges --------------------------------------------------------- */

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";

// One mapping for every status string the schema allows, so a status renders
// the same colour wherever it appears.
const STATUS_TONES: Record<string, Tone> = {
  // generic lifecycle
  active: "success",
  inactive: "neutral",
  trial: "info",
  suspended: "danger",
  cancelled: "neutral",
  draft: "neutral",
  pending: "warning",
  approved: "success",
  rejected: "danger",
  completed: "success",
  confirmed: "success",
  in_progress: "info",
  on_hold: "warning",
  planning: "neutral",
  planned: "neutral",
  // attendance
  present: "success",
  late: "warning",
  absent: "danger",
  half_day: "warning",
  on_leave: "info",
  holiday: "neutral",
  weekend: "neutral",
  // fleet
  available: "success",
  in_use: "info",
  maintenance: "warning",
  retired: "neutral",
  scheduled: "info",
  // procurement
  received: "success",
  partially_received: "warning",
  blacklisted: "danger",
  in_transit: "info",
  delivered: "success",
  delayed: "danger",
  // finance
  sent: "info",
  partially_paid: "warning",
  paid: "success",
  overdue: "danger",
  void: "neutral",
  reimbursed: "success",
  // deals / tasks
  open: "info",
  won: "success",
  lost: "danger",
  todo: "neutral",
  review: "warning",
  done: "success",
  urgent: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
  // assets / misc
  in_store: "neutral",
  under_repair: "warning",
  disposed: "neutral",
  missed: "danger",
  new: "info",
  good: "success",
  fair: "warning",
  poor: "danger",
  damaged: "danger",
};

export function StatusBadge({
  status,
  label,
}: {
  status: string | null | undefined;
  label?: string;
}) {
  const key = (status ?? "").toLowerCase();
  const tone = STATUS_TONES[key] ?? "neutral";
  const text = label ?? key.replace(/_/g, " ");
  return <span className={`badge badge-${tone} capitalize`}>{text || "—"}</span>;
}

/* --- small helpers -------------------------------------------------------- */

export function Avatar({
  name,
  url,
  size = 32,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  const text = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  if (url) {
    // Plain <img>: avatars are tiny, arbitrary-origin, and never worth a
    // next/image optimisation round trip.
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid place-items-center rounded-full bg-primary-soft text-primary font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {text || "?"}
    </span>
  );
}

export function Progress({ value, max = 100 }: { value: number; max?: number }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Label/value row for detail panels. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2.5 flex items-start justify-between gap-4 border-b border-border last:border-0">
      <dt className="text-[0.8125rem] text-fg-muted shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-right">{children ?? "—"}</dd>
    </div>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 px-5 py-4 border-b border-border bg-surface-2">
      {children}
    </div>
  );
}
