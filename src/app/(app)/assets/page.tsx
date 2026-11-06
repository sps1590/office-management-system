import type { Metadata } from "next";
import { AlertTriangle, Laptop, Wrench } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { assetStats, listAssets } from "@/lib/workplace";
import { listDepartments, pickableUsers } from "@/lib/employees";
import { assignAssetAction, createAssetAction } from "@/lib/actions/workplace";
import AutoForm from "@/components/forms/AutoForm";
import FilterBar from "@/components/FilterBar";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { addDays, compact, formatDate, isoDate, money } from "@/lib/utils";

export const metadata: Metadata = { title: "Asset register" };

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const user = await requirePermission("assets", "view");
  const tz = user.tenant.timezone;
  const sp = await searchParams;

  const [assets, stats, people, departments] = await Promise.all([
    listAssets(user.tenant_id, { q: sp.q, status: sp.status }),
    assetStats(user.tenant_id, tz),
    pickableUsers(user.tenant_id),
    listDepartments(user.tenant_id),
  ]);

  const canCreate = hasPermission(user, "assets", "create");
  const canEdit = hasPermission(user, "assets", "edit");
  const currency = user.tenant.currency;

  return (
    <>
      <PageHeader
        title="Asset register"
        description="Company equipment, who holds it, and its condition. Reassigning closes the previous holder's record, so custody reads as a chain."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Assets" value={stats.total} icon={<Laptop size={16} />} />
        <KpiCard label="Issued to staff" value={stats.in_use} tone="info" />
        <KpiCard
          label="Under repair"
          value={stats.under_repair}
          icon={<Wrench size={16} />}
          tone={stats.under_repair > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Book value"
          value={`${currency} ${compact(stats.book_value)}`}
          sub={
            stats.warranty_due > 0
              ? `${stats.warranty_due} warranty expiring within 60 days`
              : "No warranties expiring soon"
          }
          icon={stats.warranty_due > 0 ? <AlertTriangle size={16} /> : undefined}
          tone={stats.warranty_due > 0 ? "warning" : "default"}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          <Card bodyClassName="p-0">
            <FilterBar
              filters={[
                { name: "q", label: "Search", type: "search", value: sp.q, placeholder: "Name, tag, serial" },
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  value: sp.status,
                  options: ["in_use", "in_store", "under_repair", "disposed", "lost"].map(
                    (s) => ({ value: s, label: s.replace(/_/g, " ") })
                  ),
                },
              ]}
            />
            {assets.length === 0 ? (
              <EmptyState
                icon={<Laptop size={20} />}
                title="No assets registered"
                description="Register equipment to track who holds it and when its warranty ends."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Category</th>
                      <th>Held by</th>
                      <th>Condition</th>
                      <th>Warranty</th>
                      <th className="right">Value</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((a) => {
                      const warrantySoon =
                        a.warranty_expiry &&
                        a.warranty_expiry < addDays(isoDate(tz), 60);
                      return (
                        <tr key={a.id}>
                          <td>
                            <span className="block font-medium">{a.name}</span>
                            <span className="block text-xs text-fg-subtle">
                              {a.asset_tag}
                              {a.serial_number ? ` · ${a.serial_number}` : ""}
                            </span>
                          </td>
                          <td className="text-fg-muted">{a.category ?? "—"}</td>
                          <td className="text-fg-muted">
                            <span className="block">{a.assigned_to_name ?? "In store"}</span>
                            <span className="block text-xs text-fg-subtle">
                              {a.department_name ?? a.location ?? ""}
                            </span>
                          </td>
                          <td>
                            <StatusBadge status={a.condition} />
                          </td>
                          <td className={warrantySoon ? "text-warning font-medium" : "text-fg-muted"}>
                            {formatDate(a.warranty_expiry, tz)}
                          </td>
                          <td className="right">
                            {a.current_value != null || a.purchase_cost != null
                              ? money(a.current_value ?? a.purchase_cost ?? 0, currency)
                              : "—"}
                          </td>
                          <td>
                            <StatusBadge status={a.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {canEdit && assets.length > 0 && (
            <Card title="Assign or update an asset">
              <AutoForm
                action={assignAssetAction}
                columns={3}
                submitLabel="Apply"
                fields={[
                  {
                    name: "assetId",
                    label: "Asset",
                    type: "select",
                    required: true,
                    options: assets.map((a) => ({
                      value: a.id,
                      label: `${a.name} (${a.asset_tag})`,
                    })),
                  },
                  {
                    name: "userId",
                    label: "Hand to",
                    type: "select",
                    options: people.map((p) => ({ value: p.id, label: p.full_name })),
                    help: "Leave blank to return it to store.",
                  },
                  {
                    name: "status",
                    label: "Status",
                    type: "select",
                    required: true,
                    defaultValue: "in_use",
                    options: ["in_use", "in_store", "under_repair", "disposed", "lost"].map(
                      (s) => ({ value: s, label: s.replace(/_/g, " ") })
                    ),
                  },
                ]}
              />
            </Card>
          )}
        </div>

        {canCreate && (
          <Card title="Register an asset">
            <AutoForm
              action={createAssetAction}
              columns={1}
              submitLabel="Register asset"
              resetOnSuccess
              fields={[
                { name: "name", label: "Asset name", required: true, placeholder: "Dell Latitude 5440" },
                { name: "assetTag", label: "Asset tag", help: "Generated if left blank." },
                { name: "category", label: "Category", placeholder: "Laptop, furniture, phone…" },
                { name: "serialNumber", label: "Serial number" },
                {
                  name: "assignedTo",
                  label: "Assign to",
                  type: "select",
                  options: people.map((p) => ({ value: p.id, label: p.full_name })),
                },
                {
                  name: "departmentId",
                  label: "Department",
                  type: "select",
                  options: departments.map((d) => ({ value: d.id, label: d.name })),
                },
                { name: "purchaseDate", label: "Purchase date", type: "date" },
                { name: "purchaseCost", label: `Purchase cost (${currency})`, type: "number", min: 0, step: "0.01", defaultValue: 0 },
                { name: "warrantyExpiry", label: "Warranty expiry", type: "date" },
                {
                  name: "condition",
                  label: "Condition",
                  type: "select",
                  required: true,
                  defaultValue: "new",
                  options: ["new", "good", "fair", "poor", "damaged"].map((c) => ({
                    value: c,
                    label: c,
                  })),
                },
                { name: "location", label: "Location" },
              ]}
            />
          </Card>
        )}
      </div>
    </>
  );
}
