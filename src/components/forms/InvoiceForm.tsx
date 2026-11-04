"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { createInvoiceAction } from "@/lib/actions/finance";
import SubmitButton from "@/components/SubmitButton";
import FieldError from "@/components/FieldError";
import { money } from "@/lib/utils";
import type { ActionState } from "@/lib/types";

type Line = { key: number; description: string; quantity: string; unitPrice: string };

/** Invoice entry with variable lines and a live total. */
export default function InvoiceForm({
  clients,
  deals,
  currency,
  today,
}: {
  clients: { id: string; name: string }[];
  deals: { id: string; title: string }[];
  currency: string;
  today: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createInvoiceAction, null);
  const [lines, setLines] = useState<Line[]>([
    { key: 1, description: "", quantity: "1", unitPrice: "0" },
  ]);
  const [tax, setTax] = useState("0");
  const [discount, setDiscount] = useState("0");

  const subtotal = lines.reduce(
    (s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0),
    0
  );
  const total = Math.max(0, subtotal + (Number(tax) || 0) - (Number(discount) || 0));

  function update(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  return (
    <form action={action} className="space-y-4">
      {state?.error && (
        <div className="alert alert-error flex items-start gap-2" role="alert">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      {state?.success && (
        <div className="alert alert-success flex items-start gap-2" role="status">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>{state.success}</span>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="clientId">
            Client
          </label>
          <select id="clientId" name="clientId" className="input">
            <option value="">No client linked</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="dealId">
            Related deal <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <select id="dealId" name="dealId" className="input">
            <option value="">None</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="issueDate">
            Issue date
          </label>
          <input
            id="issueDate"
            name="issueDate"
            type="date"
            required
            defaultValue={today}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="dueDate">
            Due date
          </label>
          <input id="dueDate" name="dueDate" type="date" className="input" />
        </div>
      </div>

      <div>
        <p className="label">Lines</p>
        <div className="space-y-2.5">
          {lines.map((line, index) => (
            <div key={line.key} className="grid gap-2 grid-cols-[1fr_4rem_6rem_auto] items-center">
              <input
                name="lineDescription"
                value={line.description}
                onChange={(e) => update(line.key, { description: e.target.value })}
                placeholder={`Description of item ${index + 1}`}
                className="input"
              />
              <input
                name="lineQuantity"
                type="number"
                min="0"
                step="0.01"
                value={line.quantity}
                onChange={(e) => update(line.key, { quantity: e.target.value })}
                className="input tnum"
                aria-label="Quantity"
              />
              <input
                name="lineUnitPrice"
                type="number"
                min="0"
                step="0.01"
                value={line.unitPrice}
                onChange={(e) => update(line.key, { unitPrice: e.target.value })}
                className="input tnum"
                aria-label="Unit price"
              />
              <button
                type="button"
                onClick={() =>
                  setLines((p) => (p.length > 1 ? p.filter((l) => l.key !== line.key) : p))
                }
                className="btn btn-ghost btn-icon"
                aria-label={`Remove line ${index + 1}`}
                disabled={lines.length === 1}
              >
                <Trash2 size={15} />
              </button>
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
                description: "",
                quantity: "1",
                unitPrice: "0",
              },
            ])
          }
          className="btn btn-secondary btn-sm mt-2.5"
        >
          <Plus size={14} />
          Add line
        </button>
      </div>

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
          <label className="label" htmlFor="discountAmount">
            Discount ({currency})
          </label>
          <input
            id="discountAmount"
            name="discountAmount"
            type="number"
            min="0"
            step="0.01"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            className="input tnum"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="notes">
          Notes <span className="font-normal text-fg-subtle">(optional)</span>
        </label>
        <textarea id="notes" name="notes" rows={2} className="input" />
        <FieldError errors={state?.fieldErrors} name="notes" />
      </div>

      <dl className="pt-3 border-t border-border space-y-1.5">
        <div className="flex justify-between text-sm">
          <dt className="text-fg-muted">Subtotal</dt>
          <dd className="tnum">{money(subtotal, currency)}</dd>
        </div>
        <div className="flex justify-between font-semibold">
          <dt>Total</dt>
          <dd className="tnum">{money(total, currency)}</dd>
        </div>
      </dl>

      <SubmitButton className="btn-primary w-full" pendingLabel="Raising…">
        Raise invoice
      </SubmitButton>
      <p className="help">
        Raising an invoice posts it to receivables and sales revenue. Record the money
        separately when it arrives.
      </p>
    </form>
  );
}
