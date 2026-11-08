import type { Metadata } from "next";
import { Contact, MapPin, MapPinOff, Trash2 } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { listClients } from "@/lib/crm";
import { pickableUsers } from "@/lib/employees";
import {
  createClientAction,
  deleteClientAction,
  updateClientAction,
} from "@/lib/actions/crm";
import ActionButton from "@/components/ActionButton";
import AutoForm from "@/components/forms/AutoForm";
import EditDialog from "@/components/forms/EditDialog";
import FilterBar from "@/components/FilterBar";
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "@/components/ui";
import { compact, money } from "@/lib/utils";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; owner?: string }>;
}) {
  const user = await requirePermission("crm", "view");
  const sp = await searchParams;

  const [clients, people] = await Promise.all([
    listClients(user.tenant_id, { q: sp.q, status: sp.status, ownerId: sp.owner }),
    pickableUsers(user.tenant_id),
  ]);

  const canCreate = hasPermission(user, "crm", "create");
  const canEdit = hasPermission(user, "crm", "edit");
  const currency = user.tenant.currency;
  const located = clients.filter((c) => c.latitude != null).length;
  const openValue = clients.reduce((s, c) => s + c.open_value, 0);

  return (
    <>
      <PageHeader
        title="Clients"
        description="Accounts and leads. A client with recorded coordinates lets field visits be verified against its address."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Clients" value={clients.length} icon={<Contact size={16} />} />
        <KpiCard
          label="Active accounts"
          value={clients.filter((c) => c.status === "active").length}
          tone="success"
        />
        <KpiCard
          label="Leads and prospects"
          value={clients.filter((c) => ["lead", "prospect"].includes(c.status)).length}
          tone="info"
        />
        <KpiCard
          label="Open pipeline"
          value={`${currency} ${compact(openValue)}`}
          sub={`${located} of ${clients.length} have coordinates`}
          icon={located === clients.length ? <MapPin size={16} /> : <MapPinOff size={16} />}
          tone={located < clients.length ? "warning" : "success"}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <Card bodyClassName="p-0">
          <FilterBar
            filters={[
              { name: "q", label: "Search", type: "search", value: sp.q, placeholder: "Name, contact, industry" },
              {
                name: "status",
                label: "Status",
                type: "select",
                value: sp.status,
                options: ["lead", "prospect", "active", "inactive", "churned"].map((s) => ({
                  value: s,
                  label: s,
                })),
              },
              {
                name: "owner",
                label: "Owner",
                type: "select",
                value: sp.owner,
                options: people.map((p) => ({ value: p.id, label: p.full_name })),
              },
            ]}
          />
          {clients.length === 0 ? (
            <EmptyState
              icon={<Contact size={20} />}
              title="No clients yet"
              description="Add an account to start building a pipeline against it."
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Contact</th>
                    <th>Industry</th>
                    <th>Owner</th>
                    <th className="right">Deals</th>
                    <th className="right">Open value</th>
                    <th>Location</th>
                    <th>Status</th>
                    {canEdit && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <span className="block font-medium">{c.name}</span>
                        <span className="block text-xs text-fg-subtle">
                          {c.client_code ?? "—"}
                          {c.source ? ` · ${c.source}` : ""}
                        </span>
                      </td>
                      <td className="text-fg-muted">
                        <span className="block">{c.contact_person ?? "—"}</span>
                        <span className="block text-xs text-fg-subtle">
                          {c.phone ?? c.email ?? ""}
                        </span>
                      </td>
                      <td className="text-fg-muted">{c.industry ?? "—"}</td>
                      <td className="text-fg-muted">{c.owner_name ?? "—"}</td>
                      <td className="right">{c.deal_count}</td>
                      <td className="right">{money(c.open_value, currency)}</td>
                      <td>
                        {c.latitude != null ? (
                          <span className="badge badge-success">
                            <MapPin size={11} />
                            Pinned
                          </span>
                        ) : (
                          <span className="badge badge-neutral">Not set</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={c.status} />
                      </td>
                      {canEdit && (
                        <td>
                          <span className="flex items-center gap-0.5">
                            <EditDialog
                              title={`Edit ${c.name}`}
                              action={updateClientAction}
                              hidden={{ clientId: c.id }}
                              fields={[
                                { name: "name", label: "Client name", required: true, defaultValue: c.name },
                                {
                                  name: "status",
                                  label: "Status",
                                  type: "select",
                                  required: true,
                                  defaultValue: c.status,
                                  options: ["lead", "prospect", "active", "inactive", "churned"].map(
                                    (v) => ({ value: v, label: v })
                                  ),
                                },
                                { name: "industry", label: "Industry", defaultValue: c.industry ?? "" },
                                {
                                  name: "contactPerson",
                                  label: "Contact person",
                                  defaultValue: c.contact_person ?? "",
                                },
                                { name: "email", label: "Email", type: "email", defaultValue: c.email ?? "" },
                                { name: "phone", label: "Phone", type: "tel", defaultValue: c.phone ?? "" },
                                { name: "source", label: "Lead source", defaultValue: c.source ?? "" },
                                {
                                  name: "ownerId",
                                  label: "Account owner",
                                  type: "select",
                                  defaultValue: c.owner_id ?? "",
                                  options: [
                                    { value: "", label: "Nobody" },
                                    ...people.map((pp) => ({ value: pp.id, label: pp.full_name })),
                                  ],
                                },
                                {
                                  name: "address",
                                  label: "Address",
                                  type: "textarea",
                                  rows: 2,
                                  defaultValue: c.address ?? "",
                                },
                                {
                                  name: "latitude",
                                  lngName: "longitude",
                                  label: "Location",
                                  type: "location",
                                  defaultValue: c.latitude,
                                  defaultLng: c.longitude,
                                },
                              ]}
                            />
                            <ActionButton
                              action={deleteClientAction}
                              values={{ id: c.id }}
                              label=""
                              title={`Delete ${c.name}`}
                              className="btn-ghost btn-icon"
                              icon={<Trash2 size={14} />}
                              confirm={`Delete ${c.name}? This only works while they have no deals, invoices or visits.`}
                            />
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {canCreate && (
          <Card title="Add a client">
            <AutoForm
              action={createClientAction}
              columns={1}
              submitLabel="Add client"
              resetOnSuccess
              fields={[
                { name: "name", label: "Client name", required: true },
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  required: true,
                  defaultValue: "lead",
                  options: ["lead", "prospect", "active", "inactive", "churned"].map((s) => ({
                    value: s,
                    label: s,
                  })),
                },
                { name: "industry", label: "Industry" },
                { name: "contactPerson", label: "Contact person" },
                { name: "email", label: "Email", type: "email" },
                { name: "phone", label: "Phone", type: "tel" },
                { name: "source", label: "Lead source", placeholder: "Referral, web, event…" },
                {
                  name: "ownerId",
                  label: "Account owner",
                  type: "select",
                  options: people.map((p) => ({ value: p.id, label: p.full_name })),
                  help: "Defaults to you.",
                },
                { name: "address", label: "Address", type: "textarea", rows: 2 },
                {
                  name: "latitude",
                  lngName: "longitude",
                  label: "Location",
                  type: "location",
                  help: "Place the pin to allow GPS verification of visits here.",
                },
              ]}
            />
          </Card>
        )}
      </div>
    </>
  );
}
