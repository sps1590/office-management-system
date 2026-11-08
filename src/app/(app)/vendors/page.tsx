import type { Metadata } from "next";
import { Star, Store, Trash2 } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { listVendors, spendByVendor } from "@/lib/procurement";
import {
  createVendorAction,
  deleteVendorAction,
  updateVendorAction,
} from "@/lib/actions/procurement";
import ActionButton from "@/components/ActionButton";
import AutoForm from "@/components/forms/AutoForm";
import FilterBar from "@/components/FilterBar";
import { RowBars } from "@/components/charts";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { compact, money } from "@/lib/utils";

export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const user = await requirePermission("vendors", "view");
  const tz = user.tenant.timezone;
  const sp = await searchParams;

  const [vendors, spend] = await Promise.all([
    listVendors(user.tenant_id, { q: sp.q, status: sp.status }),
    spendByVendor(user.tenant_id, tz),
  ]);

  const canCreate = hasPermission(user, "vendors", "create");
  const canEdit = hasPermission(user, "vendors", "edit");
  const currency = user.tenant.currency;
  const totalSpend = vendors.reduce((s, v) => s + v.total_spend, 0);
  const rated = vendors.filter((v) => v.rating > 0);

  return (
    <>
      <PageHeader
        title="Vendors"
        description="Approved suppliers, their rating and what you have committed to each this year."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Vendors" value={vendors.length} icon={<Store size={16} />} />
        <KpiCard
          label="Active"
          value={vendors.filter((v) => v.status === "active").length}
          tone="success"
        />
        <KpiCard
          label="Blacklisted"
          value={vendors.filter((v) => v.status === "blacklisted").length}
          tone={vendors.some((v) => v.status === "blacklisted") ? "danger" : "default"}
        />
        <KpiCard
          label="Committed spend"
          value={`${currency} ${compact(totalSpend)}`}
          sub={
            rated.length
              ? `Average rating ${(rated.reduce((s, v) => s + v.rating, 0) / rated.length).toFixed(1)}/5`
              : "No ratings yet"
          }
          icon={<Star size={16} />}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          <Card bodyClassName="p-0">
            <FilterBar
              filters={[
                { name: "q", label: "Search", type: "search", value: sp.q, placeholder: "Company, contact, category" },
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  value: sp.status,
                  options: ["active", "inactive", "blacklisted"].map((s) => ({ value: s, label: s })),
                },
              ]}
            />
            {vendors.length === 0 ? (
              <EmptyState
                icon={<Store size={20} />}
                title="No vendors yet"
                description="Add a supplier to raise purchase orders against it."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th>Contact</th>
                      <th>Category</th>
                      <th>Rating</th>
                      <th className="right">Orders</th>
                      <th className="right">Spend</th>
                      <th>Status</th>
                      {canEdit && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {vendors.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <span className="block font-medium">{v.company_name}</span>
                          <span className="block text-xs text-fg-subtle">
                            {v.vendor_code ?? "—"}
                            {v.payment_terms ? ` · ${v.payment_terms}` : ""}
                          </span>
                        </td>
                        <td className="text-fg-muted">
                          <span className="block">{v.contact_person ?? "—"}</span>
                          <span className="block text-xs text-fg-subtle">
                            {v.phone ?? v.email ?? ""}
                          </span>
                        </td>
                        <td className="text-fg-muted">{v.category ?? "—"}</td>
                        <td>
                          <Stars value={v.rating} />
                        </td>
                        <td className="right">{v.order_count}</td>
                        <td className="right">{money(v.total_spend, currency)}</td>
                        <td>
                          <StatusBadge status={v.status} />
                        </td>
                        {canEdit && (
                          <td>
                            <ActionButton
                              action={deleteVendorAction}
                              values={{ id: v.id }}
                              label=""
                              title={`Delete ${v.company_name}`}
                              className="btn-ghost btn-icon"
                              icon={<Trash2 size={14} />}
                              confirm={`Delete ${v.company_name}? This only works while you have never ordered from them — blacklist them otherwise.`}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {canEdit && vendors.length > 0 && (
            <Card title="Rate or suspend a vendor">
              <AutoForm
                action={updateVendorAction}
                columns={3}
                submitLabel="Update vendor"
                fields={[
                  {
                    name: "vendorId",
                    label: "Vendor",
                    type: "select",
                    required: true,
                    options: vendors.map((v) => ({ value: v.id, label: v.company_name })),
                  },
                  {
                    name: "rating",
                    label: "Rating (0–5)",
                    type: "number",
                    min: 0,
                    max: 5,
                    step: "0.5",
                    defaultValue: 0,
                  },
                  {
                    name: "status",
                    label: "Status",
                    type: "select",
                    required: true,
                    defaultValue: "active",
                    options: ["active", "inactive", "blacklisted"].map((s) => ({
                      value: s,
                      label: s,
                    })),
                  },
                ]}
              />
              <p className="help mt-3">
                A blacklisted vendor cannot be selected on a new purchase order.
              </p>
            </Card>
          )}
        </div>

        <div className="grid gap-4">
          <Card title="Spend by vendor, this year">
            <RowBars data={spend} format={(n) => money(n, currency)} />
          </Card>

          {canCreate && (
            <Card title="Add a vendor">
              <AutoForm
                action={createVendorAction}
                columns={1}
                submitLabel="Add vendor"
                resetOnSuccess
                fields={[
                  { name: "companyName", label: "Company name", required: true },
                  { name: "contactPerson", label: "Contact person" },
                  { name: "email", label: "Email", type: "email" },
                  { name: "phone", label: "Phone", type: "tel" },
                  { name: "category", label: "Category", placeholder: "Stationery, IT hardware…" },
                  { name: "paymentTerms", label: "Payment terms", placeholder: "Net 30" },
                  { name: "rating", label: "Initial rating", type: "number", min: 0, max: 5, step: "0.5", defaultValue: 0 },
                  { name: "address", label: "Address", type: "textarea", rows: 2 },
                ]}
              />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Stars({ value }: { value: number }) {
  if (!value) return <span className="text-fg-subtle text-sm">Unrated</span>;
  return (
    <span className="flex items-center gap-1 text-sm" title={`${value} out of 5`}>
      <Star size={13} className="text-warning" fill="currentColor" />
      <span className="tnum font-medium">{value.toFixed(1)}</span>
    </span>
  );
}
