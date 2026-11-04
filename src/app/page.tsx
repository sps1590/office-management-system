import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowRight,
  Banknote,
  Boxes,
  Building2,
  CalendarCheck,
  ClipboardList,
  Fuel,
  LineChart,
  MapPin,
  Satellite,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";
import Logo from "@/components/Logo";
import { getSessionUser } from "@/lib/auth";

const MODULES = [
  {
    icon: Users,
    title: "Human Resources",
    text: "Employee directory, geo-fenced check-in/out, 8-hour and overtime computation, multi-layer leave approvals, payroll runs and payslips.",
  },
  {
    icon: Truck,
    title: "Fleet & Vehicles",
    text: "Vehicle registry with document expiry tracking, driver assignment, calendar-based requisition with approval, trip logs and maintenance scheduling.",
  },
  {
    icon: Boxes,
    title: "Procurement & Supply Chain",
    text: "Vendor ratings and price history, inventory with reorder alerts, purchase orders with multi-tier financial approval, logistics routing.",
  },
  {
    icon: LineChart,
    title: "Sales & Field Operations",
    text: "CRM pipeline on a kanban board, clients, deals, activity log, and field visits verified against the client's recorded coordinates.",
  },
  {
    icon: Banknote,
    title: "Finance & Accounts",
    text: "Double-entry general ledger with auto-posting, receivables and payables, payments, and expense claims with an approval trail.",
  },
  {
    icon: Building2,
    title: "Facilities & Tasks",
    text: "Meeting-room booking, asset register with assignment history, visitor log, projects and tasks with GPS-stamped completion.",
  },
];

const PILLARS = [
  {
    icon: Activity,
    title: "Executive MIS dashboard",
    text: "One screen across attendance, sales, procurement bottlenecks and fleet utilisation — the numbers management actually asks for.",
  },
  {
    icon: MapPin,
    title: "Live operations map",
    text: "Every active vehicle, delivery and field team plotted in real time, with route playback for any day.",
  },
  {
    icon: Satellite,
    title: "GPS telemetry engine",
    text: "Device-token ingest built for an MDM-deployed mobile client: batched, offline-tolerant, idempotent, with geofencing and deviation alerts.",
  },
  {
    icon: ShieldCheck,
    title: "Multi-tenant isolation",
    text: "Every query is scoped to your company from the session, enforced by a check that runs before each commit. Ten roles, each with an editable permission matrix.",
  },
];

export default async function HomePage() {
  if (await getSessionUser()) redirect("/dashboard");

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo size={28} />
            <span className="font-semibold tracking-tight">OMS</span>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/login" className="btn btn-ghost">
              Sign in
            </Link>
            <Link href="/register" className="btn btn-primary">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pt-16 pb-14 sm:pt-24 sm:pb-20">
          <div className="max-w-3xl fade-up">
            <span className="badge badge-primary">Multi-tenant SaaS · v1.0</span>
            <h1 className="mt-5 text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.08]">
              Run the entire office from one system.
            </h1>
            <p className="mt-5 text-lg text-fg-muted leading-relaxed">
              Human resources, fleet logistics, procurement and supply chain,
              finance, CRM and field operations — unified, with an executive
              dashboard and a live operations map on top of it all.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/register" className="btn btn-primary">
                Register your company
                <ArrowRight size={16} />
              </Link>
              <Link href="/login" className="btn btn-secondary">
                Sign in
              </Link>
            </div>
          </div>

          <dl className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { k: "Functional modules", v: "9" },
              { k: "Pre-configured roles", v: "10" },
              { k: "Database tables", v: "50+" },
              { k: "Runtime dependencies", v: "8" },
            ].map((s) => (
              <div key={s.k} className="card p-5">
                <dd className="kpi-value">{s.v}</dd>
                <dt className="mt-1 text-[0.8125rem] text-fg-muted">{s.k}</dt>
              </div>
            ))}
          </dl>
        </section>

        {/* Pillars */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Built for management visibility
            </h2>
            <p className="mt-2.5 max-w-2xl text-fg-muted">
              The parts a department-by-department tool stack never gives you.
            </p>
            <div className="mt-10 grid sm:grid-cols-2 gap-5">
              {PILLARS.map(({ icon: Icon, title, text }) => (
                <div key={title} className="card card-hover p-6">
                  <span className="grid place-items-center h-10 w-10 rounded-xl bg-primary-soft text-primary">
                    <Icon size={20} />
                  </span>
                  <h3 className="mt-4 font-semibold tracking-tight">{title}</h3>
                  <p className="mt-1.5 text-sm text-fg-muted leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Modules */}
        <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Every department, one workspace
          </h2>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {MODULES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="card card-hover p-6">
                <Icon size={20} className="text-primary" />
                <h3 className="mt-3.5 font-semibold tracking-tight">{title}</h3>
                <p className="mt-1.5 text-sm text-fg-muted leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="border-t border-border bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-16 text-center">
            <div className="flex justify-center gap-3 text-fg-subtle">
              <CalendarCheck size={18} />
              <ClipboardList size={18} />
              <Fuel size={18} />
              <Boxes size={18} />
              <Banknote size={18} />
            </div>
            <h2 className="mt-5 text-2xl sm:text-3xl font-semibold tracking-tight">
              Set up your workspace in under a minute
            </h2>
            <p className="mt-2.5 text-fg-muted">
              Roles, chart of accounts, leave types and sales pipeline are created
              for you.
            </p>
            <Link href="/register" className="btn btn-primary mt-7">
              Create your company workspace
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-wrap items-center justify-between gap-4 text-sm text-fg-subtle">
          <div className="flex items-center gap-2">
            <Logo size={20} />
            <span>Office Management System</span>
          </div>
          <span>© {new Date().getFullYear()} · All rights reserved</span>
        </div>
      </footer>
    </div>
  );
}
