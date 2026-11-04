import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import TrackerClient from "@/components/TrackerClient";
import Logo from "@/components/Logo";

export const metadata: Metadata = { title: "Field tracker" };

/**
 * Deliberately outside the app shell: a field user on a phone wants one screen
 * with a big button, not a sidebar.
 */
export default async function TrackerPage() {
  const user = await requireUser();
  const settings = await getSettings(user.tenant_id);

  return (
    <div className="min-h-dvh bg-bg">
      <header className="h-16 border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <Logo size={26} />
          <div>
            <p className="text-sm font-semibold leading-tight">Field tracker</p>
            <p className="text-[0.6875rem] text-fg-subtle">{user.tenant.company_name}</p>
          </div>
        </div>
        <Link href="/dashboard" className="btn btn-ghost btn-sm">
          <ArrowLeft size={15} />
          Dashboard
        </Link>
      </header>

      <main className="max-w-md mx-auto p-4 sm:p-6">
        <p className="text-sm text-fg-muted mb-4">
          Signed in as <strong className="text-fg">{user.full_name}</strong>. Your
          company retains location data for {settings.telemetry_retention_days} days.
        </p>
        <TrackerClient intervalSeconds={settings.telemetry_interval_seconds} />
      </main>
    </div>
  );
}
