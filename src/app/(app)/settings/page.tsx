import type { Metadata } from "next";
import { Building2, Clock, Satellite, Workflow } from "lucide-react";
import { isCompanyAdmin, requirePermission } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { getDb } from "@/lib/db";
import {
  updateApprovalsAction,
  updateCompanyAction,
  updateSettingsAction,
} from "@/lib/actions/admin";
import AutoForm from "@/components/forms/AutoForm";
import { Card, Field, PageHeader } from "@/components/ui";
import { duration, formatDate, monthName } from "@/lib/utils";

export const metadata: Metadata = { title: "Company settings" };

const ROLE_KEYS = [
  "procurement_manager",
  "finance_manager",
  "fleet_manager",
  "hr_manager",
  "it_mis_manager",
  "company_admin",
];

export default async function SettingsPage() {
  const user = await requirePermission("settings", "view");
  const tz = user.tenant.timezone;
  // Offered as a list rather than a text box: this zone is what every date
  // in the app is rendered through, so a typo would be felt everywhere.
  const timeZones = Intl.supportedValuesOf("timeZone");
  const nowThere = new Date().toLocaleString("en-GB", {
    timeZone: timeZones.includes(tz) ? tz : "UTC",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const settings = await getSettings(user.tenant_id);
  const db = await getDb();

  const rows = await db`
    SELECT t.company_name, t.slug, t.status, t.plan_key, t.currency, t.timezone,
           t.country, t.address, t.phone, t.email, t.trial_ends_on, t.created_at,
           p.name AS plan_name, p.max_users,
           (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) AS user_count
      FROM tenants t
      LEFT JOIN subscription_plans p ON p.key = t.plan_key
     WHERE t.id = ${user.tenant_id}
  `;
  const tenant = rows[0] as {
    company_name: string;
    slug: string;
    status: string;
    plan_key: string;
    currency: string;
    timezone: string;
    country: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    trial_ends_on: string | null;
    created_at: string;
    plan_name: string | null;
    max_users: number | null;
    user_count: number;
  };

  const tiers = settings.po_approval_tiers;

  return (
    <>
      <PageHeader
        title="Company settings"
        description="Every formula the system applies is a value here, so policy changes need no deploy."
      />

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Card title="Subscription">
          <dl>
            <Field label="Company">{tenant.company_name}</Field>
            <Field label="Workspace">{tenant.slug}</Field>
            <Field label="Status">
              <span className="capitalize">{tenant.status}</span>
            </Field>
            <Field label="Plan">{tenant.plan_name ?? tenant.plan_key}</Field>
            <Field label="Users">
              {tenant.user_count}
              {tenant.max_users ? ` of ${tenant.max_users}` : " (unlimited)"}
            </Field>
            {tenant.trial_ends_on && (
              <Field label="Trial ends">{formatDate(tenant.trial_ends_on, tz)}</Field>
            )}
            <Field label="Created">{formatDate(tenant.created_at, tz)}</Field>
          </dl>
        </Card>

        {isCompanyAdmin(user) && (
          <Card title="Company profile">
            <AutoForm
              action={updateCompanyAction}
              submitLabel="Save profile"
              fields={[
                { name: "companyName", label: "Company name", required: true, defaultValue: tenant.company_name, span: 2 },
                { name: "email", label: "Email", type: "email", defaultValue: tenant.email ?? "" },
                { name: "phone", label: "Phone", type: "tel", defaultValue: tenant.phone ?? "" },
                { name: "country", label: "Country", defaultValue: tenant.country ?? "" },
                { name: "currency", label: "Currency", required: true, defaultValue: tenant.currency, help: "Three-letter code." },
                {
                  name: "timezone",
                  label: "Timezone",
                  type: "select",
                  required: true,
                  defaultValue: tenant.timezone,
                  options: timeZones.map((z) => ({ value: z, label: z })),
                  help: `Every date and time in the app is shown in this zone. It is ${nowThere} there now.`,
                  span: 2,
                },
                { name: "address", label: "Address", type: "textarea", rows: 2, defaultValue: tenant.address ?? "", span: 2 },
              ]}
            />
          </Card>
        )}
      </div>

      <Card title="Attendance, overtime and GPS" className="mt-4">
        <div className="grid gap-3 sm:grid-cols-3 mb-5">
          <div className="panel p-3.5">
            <p className="text-xs text-fg-muted flex items-center gap-1.5">
              <Clock size={13} />
              Standard day
            </p>
            <p className="font-semibold mt-1">{duration(settings.standard_work_minutes)}</p>
          </div>
          <div className="panel p-3.5">
            <p className="text-xs text-fg-muted">Overtime after</p>
            <p className="font-semibold mt-1">
              {duration(settings.overtime_after_minutes)} at {settings.overtime_multiplier}×
            </p>
          </div>
          <div className="panel p-3.5">
            <p className="text-xs text-fg-muted flex items-center gap-1.5">
              <Satellite size={13} />
              Telemetry
            </p>
            <p className="font-semibold mt-1">
              every {settings.telemetry_interval_seconds}s, kept{" "}
              {settings.telemetry_retention_days} days
            </p>
          </div>
        </div>

        <AutoForm
          action={updateSettingsAction}
          columns={3}
          submitLabel="Save settings"
          fields={[
            { name: "workStartTime", label: "Work starts at", type: "time", required: true, defaultValue: settings.work_start_time.slice(0, 5) },
            { name: "standardWorkMinutes", label: "Standard day (minutes)", type: "number", required: true, min: 60, max: 1440, defaultValue: settings.standard_work_minutes },
            { name: "graceMinutes", label: "Late grace (minutes)", type: "number", required: true, min: 0, max: 240, defaultValue: settings.grace_minutes },
            { name: "overtimeAfterMinutes", label: "Overtime after (minutes)", type: "number", required: true, min: 60, max: 1440, defaultValue: settings.overtime_after_minutes },
            { name: "overtimeMultiplier", label: "Overtime multiplier", type: "number", required: true, min: 1, max: 5, step: "0.05", defaultValue: settings.overtime_multiplier },
            { name: "attendanceRadiusMeters", label: "Check-in radius (metres)", type: "number", required: true, min: 20, defaultValue: settings.attendance_radius_meters },
            { name: "requireGeofencedCheckin", label: "Require a location inside an office geofence to check in", type: "checkbox", defaultValue: settings.require_geofenced_checkin, span: 3 },
            { name: "telemetryIntervalSeconds", label: "GPS interval (seconds)", type: "number", required: true, min: 15, max: 3600, defaultValue: settings.telemetry_interval_seconds },
            { name: "telemetryRetentionDays", label: "GPS retention (days)", type: "number", required: true, min: 1, max: 3650, defaultValue: settings.telemetry_retention_days },
            { name: "deviationThresholdMeters", label: "Deviation threshold (metres)", type: "number", required: true, min: 100, defaultValue: settings.deviation_threshold_meters },
            { name: "trackingWindowStart", label: "Tracking window from", type: "time", required: true, defaultValue: settings.tracking_window_start.slice(0, 5) },
            { name: "trackingWindowEnd", label: "Tracking window to", type: "time", required: true, defaultValue: settings.tracking_window_end.slice(0, 5) },
            { name: "fiscalYearStartMonth", label: "Fiscal year starts", type: "select", required: true, defaultValue: String(settings.fiscal_year_start_month), options: Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) })) },
            { name: "invoicePrefix", label: "Invoice prefix", required: true, defaultValue: settings.invoice_prefix },
            { name: "poPrefix", label: "Purchase order prefix", required: true, defaultValue: settings.po_prefix },
          ]}
        />
      </Card>

      <Card title="Approval workflows" className="mt-4">
        <div className="grid gap-3 sm:grid-cols-2 mb-5">
          <div className="panel p-3.5">
            <p className="text-xs text-fg-muted flex items-center gap-1.5">
              <Workflow size={13} />
              Leave chain
            </p>
            <p className="font-semibold mt-1 capitalize">
              Employee → {settings.leave_approval_stages.join(" → ").replace(/_/g, " ")}
            </p>
          </div>
          <div className="panel p-3.5">
            <p className="text-xs text-fg-muted flex items-center gap-1.5">
              <Building2 size={13} />
              Purchase order tiers
            </p>
            <p className="font-semibold mt-1 capitalize">
              {tiers.length
                ? tiers
                    .map((t) => `${t.role.replace(/_/g, " ")} ≥ ${t.amount}`)
                    .join(", ")
                : "none configured"}
            </p>
          </div>
        </div>

        <AutoForm
          action={updateApprovalsAction}
          columns={2}
          submitLabel="Save approval rules"
          fields={[
            {
              name: "leaveStages",
              label: "Leave approval stages",
              required: true,
              span: 2,
              defaultValue: settings.leave_approval_stages.join(","),
              help: 'Comma separated, in order. Use "line_manager" for the employee\'s own manager, or a role key such as hr_manager.',
            },
            {
              name: "tier1Role",
              label: "Tier 1 approver (all orders)",
              type: "select",
              required: true,
              defaultValue: tiers[0]?.role ?? "procurement_manager",
              options: ROLE_KEYS.map((r) => ({ value: r, label: r.replace(/_/g, " ") })),
            },
            {
              name: "tier2Role",
              label: "Tier 2 approver",
              type: "select",
              defaultValue: tiers[1]?.role ?? "",
              options: ROLE_KEYS.map((r) => ({ value: r, label: r.replace(/_/g, " ") })),
              help: "Leave blank for a single-tier workflow.",
            },
            {
              name: "tier2Amount",
              label: `Tier 2 applies above (${tenant.currency})`,
              type: "number",
              min: 0,
              step: "1",
              defaultValue: tiers[1]?.amount ?? 50000,
            },
            {
              name: "tier3Role",
              label: "Tier 3 approver",
              type: "select",
              defaultValue: tiers[2]?.role ?? "",
              options: ROLE_KEYS.map((r) => ({ value: r, label: r.replace(/_/g, " ") })),
            },
            {
              name: "tier3Amount",
              label: `Tier 3 applies above (${tenant.currency})`,
              type: "number",
              min: 0,
              step: "1",
              defaultValue: tiers[2]?.amount ?? 500000,
            },
          ]}
        />
      </Card>
    </>
  );
}
