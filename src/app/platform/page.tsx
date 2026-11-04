import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Building2, ShieldCheck, Smartphone, Users } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/permissions";
import { listPlans, listTenants, platformStats } from "@/lib/platform";
import { setTenantStatusAction } from "@/lib/actions/admin";
import ActionButton from "@/components/ActionButton";
import Logo from "@/components/Logo";
import { Card, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, num, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Platform operator" };

/**
 * The SaaS operator's console (SRS section 2, Super Admin). Deliberately
 * outside the tenant app shell: it is a different product surface with a
 * different audience.
 */
export default async function PlatformPage() {
  const operator = await requirePlatformAdmin();
  const [tenants, stats, plans] = await Promise.all([
    listTenants(),
    platformStats(),
    listPlans(),
  ]);

  return (
    <div className="min-h-dvh bg-bg">
      <header className="h-16 border-b border-border bg-surface flex items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Logo size={26} />
          <div>
            <p className="text-sm font-semibold leading-tight">Platform operator</p>
            <p className="text-[0.6875rem] text-fg-subtle">{operator.email}</p>
          </div>
        </div>
        <Link href="/dashboard" className="btn btn-ghost btn-sm">
          <ArrowLeft size={15} />
          Back to my company
        </Link>
      </header>

      <main className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
        <PageHeader
          title="Tenant companies"
          description="Every company on this deployment. Super Admin is granted only by the PLATFORM_ADMIN_IDENTIFIERS environment variable — never from the UI."
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Companies"
            value={stats.tenants}
            sub={`${stats.active} active · ${stats.trialing} on trial`}
            icon={<Building2 size={16} />}
          />
          <KpiCard
            label="Suspended"
            value={stats.suspended}
            tone={stats.suspended > 0 ? "warning" : "success"}
          />
          <KpiCard
            label="Users across the platform"
            value={num(stats.users)}
            sub={`${stats.live_sessions} live sessions`}
            icon={<Users size={16} />}
          />
          <KpiCard
            label="Tracking devices"
            value={stats.devices}
            icon={<Smartphone size={16} />}
          />
        </section>

        <Card title="Companies" className="mt-4" bodyClassName="p-0">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Plan</th>
                  <th className="right">Users</th>
                  <th className="right">GPS points, 24h</th>
                  <th>Last sign-in</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span className="block font-medium">{t.company_name}</span>
                      <span className="block text-xs text-fg-subtle">
                        {t.slug}
                        {t.email ? ` · ${t.email}` : ""}
                        {t.country ? ` · ${t.country}` : ""}
                      </span>
                    </td>
                    <td className="text-fg-muted">
                      {t.plan_name ?? t.plan_key}
                      {t.trial_ends_on && t.status === "trial" && (
                        <span className="block text-xs text-fg-subtle">
                          trial ends {formatDate(t.trial_ends_on)}
                        </span>
                      )}
                    </td>
                    <td className="right">
                      {t.active_users}
                      <span className="text-fg-subtle">/{t.users}</span>
                    </td>
                    <td className="right">{num(t.points_today)}</td>
                    <td className="text-fg-muted text-xs">
                      {t.last_login_at ? relativeTime(t.last_login_at) : "Never"}
                    </td>
                    <td className="text-fg-muted">{formatDate(t.created_at)}</td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                    <td>
                      <span className="flex flex-wrap gap-1.5">
                        {t.status !== "suspended" ? (
                          <ActionButton
                            action={setTenantStatusAction}
                            values={{ tenantId: t.id, status: "suspended" }}
                            label="Suspend"
                            className="btn-ghost btn-sm"
                            confirm={`Suspend ${t.company_name}? Everyone is locked out immediately and live sessions are revoked. No data is deleted.`}
                          />
                        ) : (
                          <ActionButton
                            action={setTenantStatusAction}
                            values={{ tenantId: t.id, status: "active" }}
                            label="Reactivate"
                            className="btn-ghost btn-sm"
                          />
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Subscription plans" className="mt-4" bodyClassName="p-0">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th className="right">Monthly price</th>
                  <th className="right">User cap</th>
                  <th className="right">Companies</th>
                  <th>Features</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.key}>
                    <td className="font-medium">{p.name}</td>
                    <td className="right">{num(p.price_monthly)}</td>
                    <td className="right">{p.max_users ?? "unlimited"}</td>
                    <td className="right">{p.tenants}</td>
                    <td className="text-fg-muted text-xs">
                      {Object.entries(p.features)
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <p className="mt-4 text-xs text-fg-subtle flex items-center gap-1.5">
          <ShieldCheck size={13} />
          Subscription records are modelled but no payment gateway is connected, so
          plan changes here do not bill anyone.
        </p>
      </main>
    </div>
  );
}
