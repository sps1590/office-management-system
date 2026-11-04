"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { createPurchaseOrderAction } from "@/lib/actions/procurement";
import SubmitButton from "@/components/SubmitButton";
import FieldError from "@/components/FieldError";
import { Card } from "@/components/ui";
import { money } from "@/lib/utils";
import type { ActionState } from "@/lib/types";

type Line = {
  key: number;
  inventoryItemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

/**
 * Purchase order entry with variable line items.
 *
 * Written by hand rather than with AutoForm because the line rows are dynamic
 * and the totals update as you type — the one thing a spec-driven form cannot
 * express. The lines post as parallel arrays, which the action zips back up.
 */
export default function PurchaseOrderForm({
  vendors,
  warehouses,
  items,
  currency,
  today,
}: {
  vendors: { id: string; company_name: string }[];
  warehouses: { id: string; name: string }[];
  items: { id: string; item_name: string; sku: string; unit: string; unit_cost: number }[];
  currency: string;
  today: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    createPurchaseOrderAction,
    null
  );
  const [lines, setLines] = useState<Line[]>([
    { key: 1, inventoryItemId: "", description: "", quantity: "1", unitPrice: "0" },
  ]);
  const [tax, setTax] = useState("0");
  const [shipping, setShipping] = useState("0");

  const subtotal = lines.reduce(
    (s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0),
    0
  );
  const total = subtotal + (Number(tax) || 0) + (Number(shipping) || 0);

  function update(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /** Picking a catalogue item fills the description and last known cost. */
  function pickItem(key: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    update(key, {
      inventoryItemId: itemId,
      description: item ? `${item.item_name} (${item.sku})` : "",
      unitPrice: item ? String(item.unit_cost) : "0",
    });
  }

  return (
    <form action={action} className="space-y-4 max-w-4xl">
      {state?.error && (
        <div className="alert alert-error flex items-start gap-2" role="alert">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <Card title="Order details">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="vendorId">
              Vendor
            </label>
            <select id="vendorId" name="vendorId" required className="input">
              <option value="">Select a vendor</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.company_name}
                </option>
              ))}
            </select>
            <FieldError errors={state?.fieldErrors} name="vendorId" />
          </div>
          <div>
            <label className="label" htmlFor="warehouseId">
              Deliver to warehouse{" "}
              <span className="font-normal text-fg-subtle">(optional)</span>
            </label>
            <select id="warehouseId" name="warehouseId" className="input">
              <option value="">Not specified</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="orderDate">
              Order date
            </label>
            <input
              id="orderDate"
              name="orderDate"
              type="date"
              required
              defaultValue={today}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="expectedDate">
              Expected delivery{" "}
              <span className="font-normal text-fg-subtle">(optional)</span>
            </label>
            <input id="expectedDate" name="expectedDate" type="date" className="input" />
          </div>
        </div>
      </Card>

      <Card title="Line items">
        <div className="space-y-3">
          {lines.map((line, index) => (
            <div
              key={line.key}
              className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] items-end panel p-3"
            >
              <div className="min-w-0">
                <label className="label">Item {index + 1}</label>
                <select
                  value={line.inventoryItemId}
                  onChange={(e) => pickItem(line.key, e.target.value)}
                  className="input mb-2"
                >
                  <option value="">Free-text line (not stocked)</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.item_name} — {i.sku}
                    </option>
                  ))}
                </select>
                <input type="hidden" name="itemInventoryId" value={line.inventoryItemId} />
                <input
                  name="itemDescription"
                  value={line.description}
                  onChange={(e) => update(line.key, { description: e.target.value })}
                  placeholder="Description"
                  className="input"
                />
              </div>

              <div className="w-24">
                <label className="label">Qty</label>
                <input
                  name="itemQuantity"
                  type="number"
                  min="0"
                  step="0.001"
                  value={line.quantity}
                  onChange={(e) => update(line.key, { quantity: e.target.value })}
                  className="input tnum"
                />
              </div>

              <div className="w-32">
                <label className="label">Unit price</label>
                <input
                  name="itemUnitPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.unitPrice}
                  onChange={(e) => update(line.key, { unitPrice: e.target.value })}
                  className="input tnum"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tnum w-28 text-right">
                  {money((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0), currency)}
                </span>
                <button
                  type="button"
                  onClick={() => setLines((p) => (p.length > 1 ? p.filter((l) => l.key !== line.key) : p))}
                  className="btn btn-ghost btn-icon"
                  aria-label={`Remove line ${index + 1}`}
                  disabled={lines.length === 1}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() =>
            setLines((p) => [
              ...p,
              {
                key: Math.max(...p.map((l) => l.key)) + 1,
                inventoryItemId: "",
                description: "",
                quantity: "1",
                unitPrice: "0",
              },
            ])
          }
          className="btn btn-secondary btn-sm mt-3"
        >
          <Plus size={14} />
          Add line
        </button>
      </Card>

      <Card title="Totals and terms">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="taxAmount">
              Tax / VAT ({currency})
            </label>
            <input
              id="taxAmount"
              name="taxAmount"
              type="number"
              min="0"
              step="0.01"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              className="input tnum"
            />
          </div>
          <div>
            <label className="label" htmlFor="shippingAmount">
              Shipping ({currency})
            </label>
            <input
              id="shippingAmount"
              name="shippingAmount"
              type="number"
              min="0"
              step="0.01"
              value={shipping}
              onChange={(e) => setShipping(e.target.value)}
              className="input tnum"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="terms">
              Terms <span className="font-normal text-fg-subtle">(optional)</span>
            </label>
            <textarea id="terms" name="terms" rows={2} className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="notes">
              Internal notes <span className="font-normal text-fg-subtle">(optional)</span>
            </label>
            <textarea id="notes" name="notes" rows={2} className="input" />
          </div>
        </div>

        <dl className="mt-5 pt-4 border-t border-border space-y-2 max-w-xs ml-auto">
          <div className="flex justify-between text-sm">
            <dt className="text-fg-muted">Subtotal</dt>
            <dd className="tnum">{money(subtotal, currency)}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-fg-muted">Tax</dt>
            <dd className="tnum">{money(Number(tax) || 0, currency)}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-fg-muted">Shipping</dt>
            <dd className="tnum">{money(Number(shipping) || 0, currency)}</dd>
          </div>
          <div className="flex justify-between pt-2 border-t border-border font-semibold">
            <dt>Total</dt>
            <dd className="tnum">{money(total, currency)}</dd>
          </div>
        </dl>
      </Card>

      <div className="flex items-center gap-2">
        <SubmitButton className="btn-primary" pendingLabel="Creating…">
          Create draft order
        </SubmitButton>
        <Link href="/procurement" className="btn btn-secondary">
          Cancel
        </Link>
      </div>
      <p className="help">
        The order is created as a draft. Submitting it builds the approval chain from
        the value thresholds in Company settings.
      </p>
    </form>
  );
}
