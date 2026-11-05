import type { Metadata } from "next";
import { AlertTriangle, Boxes, PackageX, Warehouse } from "lucide-react";
import { hasPermission, requirePermission } from "@/lib/permissions";
import {
  inventoryStats,
  listInventory,
  listWarehouses,
  stockMovements,
} from "@/lib/procurement";
import {
  adjustStockAction,
  createInventoryItemAction,
  createWarehouseAction,
} from "@/lib/actions/procurement";
import AutoForm from "@/components/forms/AutoForm";
import FilterBar from "@/components/FilterBar";
import { Card, EmptyState, KpiCard, PageHeader, Progress } from "@/components/ui";
import { compact, formatDateTime, money, num } from "@/lib/utils";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; warehouse?: string; low?: string }>;
}) {
  const user = await requirePermission("inventory", "view");
  const sp = await searchParams;

  const [items, stats, warehouses, movements] = await Promise.all([
    listInventory(user.tenant_id, {
      q: sp.q,
      warehouseId: sp.warehouse,
      lowOnly: sp.low === "1",
    }),
    inventoryStats(user.tenant_id),
    listWarehouses(user.tenant_id),
    stockMovements(user.tenant_id, undefined, 25),
  ]);

  const canCreate = hasPermission(user, "inventory", "create");
  const canEdit = hasPermission(user, "inventory", "edit");
  const currency = user.tenant.currency;
  const tz = user.tenant.timezone;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Real-time stock with reorder alerts. Every change is recorded as a movement, so the balance is always explained."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active items" value={stats.items} icon={<Boxes size={16} />} />
        <KpiCard
          label="At or below reorder level"
          value={stats.low_stock}
          icon={<AlertTriangle size={16} />}
          tone={stats.low_stock > 0 ? "warning" : "success"}
          href="/inventory?low=1"
        />
        <KpiCard
          label="Out of stock"
          value={stats.out_of_stock}
          icon={<PackageX size={16} />}
          tone={stats.out_of_stock > 0 ? "danger" : "success"}
        />
        <KpiCard
          label="Stock value"
          value={`${currency} ${compact(stats.stock_value)}`}
          sub={`${warehouses.length} warehouse${warehouses.length === 1 ? "" : "s"}`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          <Card bodyClassName="p-0">
            <FilterBar
              filters={[
                { name: "q", label: "Search", type: "search", value: sp.q, placeholder: "Item, SKU, category" },
                {
                  name: "warehouse",
                  label: "Warehouse",
                  type: "select",
                  value: sp.warehouse,
                  options: warehouses.map((w) => ({ value: w.id, label: w.name })),
                },
                {
                  name: "low",
                  label: "Stock level",
                  type: "select",
                  value: sp.low,
                  placeholder: "All items",
                  options: [{ value: "1", label: "Needs reorder" }],
                },
              ]}
            />
            {items.length === 0 ? (
              <EmptyState
                icon={<Boxes size={20} />}
                title="No items match"
                description="Add an inventory item to start tracking stock levels and reorder points."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Warehouse</th>
                      <th className="right">In stock</th>
                      <th>Level</th>
                      <th className="right">Unit cost</th>
                      <th className="right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => {
                      const low = i.current_stock <= i.reorder_level;
                      return (
                        <tr key={i.id}>
                          <td>
                            <span className="block font-medium">{i.item_name}</span>
                            <span className="block text-xs text-fg-subtle">
                              {i.sku}
                              {i.category ? ` · ${i.category}` : ""}
                              {i.bin_location ? ` · bin ${i.bin_location}` : ""}
                            </span>
                          </td>
                          <td className="text-fg-muted">{i.warehouse_name ?? "—"}</td>
                          <td className="right">
                            <span className={low ? "text-danger font-semibold" : ""}>
                              {num(i.current_stock, 0)} {i.unit}
                            </span>
                            {low && (
                              <span className="block text-xs text-fg-subtle">
                                reorder at {num(i.reorder_level, 0)}
                              </span>
                            )}
                          </td>
                          <td className="min-w-28">
                            <Progress
                              value={i.current_stock}
                              max={Math.max(i.reorder_level * 2, i.current_stock, 1)}
                            />
                          </td>
                          <td className="right">{money(i.unit_cost, currency)}</td>
                          <td className="right">{money(i.stock_value, currency)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Recent stock movements" bodyClassName="p-0">
            {movements.length === 0 ? (
              <p className="px-5 py-5 text-sm text-fg-subtle">No movements recorded yet.</p>
            ) : (
              <div className="table-wrap max-h-80 overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Item</th>
                      <th>Type</th>
                      <th className="right">Quantity</th>
                      <th>Reference</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.id}>
                        <td className="text-fg-muted text-xs">{formatDateTime(m.created_at, tz)}</td>
                        <td className="font-medium">{m.item_name}</td>
                        <td>
                          <span
                            className={
                              m.movement_type === "in"
                                ? "badge badge-success"
                                : m.movement_type === "out"
                                  ? "badge badge-warning"
                                  : "badge badge-neutral"
                            }
                          >
                            {m.movement_type}
                          </span>
                        </td>
                        <td className="right">
                          {num(m.quantity, 0)} {m.unit}
                        </td>
                        <td className="text-fg-muted">
                          {m.note ?? m.reference_type ?? "—"}
                          {m.batch_number ? ` · batch ${m.batch_number}` : ""}
                        </td>
                        <td className="text-fg-muted">{m.created_by_name ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="grid gap-4">
          {canEdit && items.length > 0 && (
            <Card title="Record a movement">
              <AutoForm
                action={adjustStockAction}
                columns={1}
                submitLabel="Record movement"
                resetOnSuccess
                fields={[
                  {
                    name: "itemId",
                    label: "Item",
                    type: "select",
                    required: true,
                    options: items.map((i) => ({
                      value: i.id,
                      label: `${i.item_name} — ${num(i.current_stock, 0)} ${i.unit}`,
                    })),
                  },
                  {
                    name: "movementType",
                    label: "Movement",
                    type: "select",
                    required: true,
                    defaultValue: "in",
                    options: [
                      { value: "in", label: "Stock in" },
                      { value: "out", label: "Issue out" },
                      { value: "adjustment", label: "Set counted quantity" },
                    ],
                  },
                  { name: "quantity", label: "Quantity", type: "number", required: true, min: 0, step: "0.001" },
                  { name: "batchNumber", label: "Batch number" },
                  { name: "note", label: "Note", type: "textarea", rows: 2 },
                ]}
              />
            </Card>
          )}

          {canCreate && (
            <>
              <Card title="Add an item">
                <AutoForm
                  action={createInventoryItemAction}
                  columns={1}
                  submitLabel="Add item"
                  resetOnSuccess
                  fields={[
                    { name: "sku", label: "SKU", required: true, placeholder: "ITM-001" },
                    { name: "itemName", label: "Item name", required: true },
                    { name: "category", label: "Category" },
                    { name: "unit", label: "Unit", defaultValue: "pcs", placeholder: "pcs, kg, box" },
                    { name: "currentStock", label: "Opening stock", type: "number", min: 0, step: "0.001", defaultValue: 0 },
                    { name: "reorderLevel", label: "Reorder level", type: "number", min: 0, step: "0.001", defaultValue: 0 },
                    { name: "reorderQuantity", label: "Reorder quantity", type: "number", min: 0, step: "0.001", defaultValue: 0 },
                    { name: "unitCost", label: `Unit cost (${currency})`, type: "number", min: 0, step: "0.01", defaultValue: 0 },
                    {
                      name: "warehouseId",
                      label: "Warehouse",
                      type: "select",
                      options: warehouses.map((w) => ({ value: w.id, label: w.name })),
                    },
                    { name: "binLocation", label: "Bin location" },
                  ]}
                />
              </Card>

              <Card title="Warehouses">
                <ul className="space-y-2 mb-4">
                  {warehouses.length === 0 ? (
                    <li className="text-sm text-fg-subtle">None yet.</li>
                  ) : (
                    warehouses.map((w) => (
                      <li key={w.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2 min-w-0">
                          <Warehouse size={14} className="text-fg-subtle shrink-0" />
                          <span className="truncate">{w.name}</span>
                        </span>
                        <span className="badge badge-neutral shrink-0">{w.item_count}</span>
                      </li>
                    ))
                  )}
                </ul>
                <div className="pt-4 border-t border-border">
                  <AutoForm
                    action={createWarehouseAction}
                    columns={1}
                    compact
                    resetOnSuccess
                    submitLabel="Add warehouse"
                    fields={[
                      { name: "name", label: "Name", required: true },
                      { name: "code", label: "Code" },
                      { name: "address", label: "Address", type: "textarea", rows: 2 },
                      { name: "latitude", label: "Latitude", help: "Used to place it on the operations map." },
                      { name: "longitude", label: "Longitude" },
                    ]}
                  />
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
