import Link from "next/link";
import {
  Activity,
  MapPin,
  PackageSearch,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";
import Logo from "./Logo";

const HIGHLIGHTS = [
  { icon: Users, title: "People", text: "Directory, geo-fenced attendance, multi-layer leave approvals, payroll." },
  { icon: Truck, title: "Fleet", text: "Vehicle registry, requisition approvals, trip logs and maintenance." },
  { icon: PackageSearch, title: "Supply chain", text: "Vendors, inventory, purchase orders with tiered approval." },
  { icon: MapPin, title: "Live operations map", text: "Every vehicle, delivery and field team on one map, in real time." },
  { icon: Activity, title: "Executive MIS", text: "One dashboard across HR, sales, procurement and fleet." },
  { icon: ShieldCheck, title: "Isolated by design", text: "Every query scoped to your company. Granular role-based access." },
];

/** Shared frame for the sign-in and company-registration screens. */
export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh grid lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel. Hidden on small screens, where it would push the form
          below the fold. */}
      <aside className="hidden lg:flex flex-col justify-between p-10 xl:p-14 bg-[var(--primary)] text-white relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -top-32 -right-24 h-96 w-96 rounded-full opacity-25"
          style={{ background: "radial-gradient(circle, #fff, transparent 70%)" }}
        />
        <div
          aria-hidden
          className="absolute -bottom-40 -left-20 h-[28rem] w-[28rem] rounded-full opacity-15"
          style={{ background: "radial-gradient(circle, #fff, transparent 70%)" }}
        />

        <Link href="/" className="relative flex items-center gap-3 w-fit">
          <span className="grid place-items-center h-9 w-9 rounded-lg bg-white/15 backdrop-blur">
            <Logo size={22} />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Office Management System
          </span>
        </Link>

        <div className="relative max-w-xl">
          <h2 className="text-3xl xl:text-4xl font-semibold tracking-tight leading-tight">
            One system for the whole company.
          </h2>
          <p className="mt-3 text-white/75 text-[0.9375rem] leading-relaxed">
            HR, fleet, procurement, finance, CRM and field operations in a single
            multi-tenant platform — with an executive dashboard and a live
            operations map on top.
          </p>

          <ul className="mt-9 grid sm:grid-cols-2 gap-x-6 gap-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, title: t, text }) => (
              <li key={t} className="flex gap-3">
                <Icon size={18} className="mt-0.5 shrink-0 text-white/80" />
                <div>
                  <p className="text-sm font-semibold">{t}</p>
                  <p className="text-[0.8125rem] text-white/65 leading-snug">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/50">
          © {new Date().getFullYear()} Office Management System
        </p>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md fade-up">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <Logo size={30} />
            <span className="font-semibold tracking-tight">Office Management System</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-fg-muted">{subtitle}</p>

          <div className="mt-7">{children}</div>

          {footer && <div className="mt-6 text-sm text-fg-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
