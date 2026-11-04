"use client";

import { useActionState, useEffect, useRef } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import SubmitButton from "@/components/SubmitButton";
import FieldError from "@/components/FieldError";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/types";

/**
 * One form component driven by a field spec, used by every straightforward
 * create/edit screen in the product.
 *
 * The point is consistency: validation messages, the success and error
 * alerts, spacing, grid behaviour and the pending state are implemented once
 * here rather than re-typed in twenty modules, so they cannot drift apart.
 * Forms with genuinely bespoke behaviour (line items, approvals, GPS capture)
 * are still written by hand.
 */

export type FieldSpec = {
  name: string;
  label: string;
  type?:
    | "text"
    | "email"
    | "tel"
    | "url"
    | "number"
    | "date"
    | "datetime-local"
    | "time"
    | "password"
    | "select"
    | "textarea"
    | "checkbox";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: string | number | boolean | null;
  /** Column span inside the form grid (default 1). */
  span?: 1 | 2 | 3;
  step?: string;
  min?: string | number;
  max?: string | number;
  rows?: number;
};

export default function AutoForm({
  action,
  fields,
  submitLabel = "Save",
  pendingLabel = "Saving…",
  hidden,
  columns = 2,
  /** Clears the inputs after a successful submit — right for inline "add" forms. */
  resetOnSuccess = false,
  footer,
  compact = false,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  fields: FieldSpec[];
  submitLabel?: string;
  pendingLabel?: string;
  hidden?: Record<string, string>;
  columns?: 1 | 2 | 3;
  resetOnSuccess?: boolean;
  footer?: React.ReactNode;
  compact?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.success) ref.current?.reset();
  }, [state?.success, resetOnSuccess]);

  const gridCols =
    columns === 1 ? "grid-cols-1" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3";

  return (
    <form action={formAction} ref={ref} className={compact ? "space-y-3" : "space-y-4"}>
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

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

      <div className={cn("grid gap-4", gridCols)}>
        {fields.map((f) => (
          <Field key={f.name} field={f} errors={state?.fieldErrors} />
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <SubmitButton className="btn-primary" pendingLabel={pendingLabel}>
          {submitLabel}
        </SubmitButton>
        {footer}
      </div>
    </form>
  );
}

function Field({
  field: f,
  errors,
}: {
  field: FieldSpec;
  errors?: Record<string, string[]>;
}) {
  const type = f.type ?? "text";
  const invalid = !!errors?.[f.name];
  const spanClass =
    f.span === 3 ? "sm:col-span-3" : f.span === 2 ? "sm:col-span-2" : undefined;

  if (type === "checkbox") {
    return (
      <label
        className={cn(
          "flex items-start gap-2.5 py-1.5 cursor-pointer select-none",
          spanClass
        )}
      >
        <input
          name={f.name}
          type="checkbox"
          defaultChecked={!!f.defaultValue}
          className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
        />
        <span>
          <span className="text-sm font-medium">{f.label}</span>
          {f.help && <span className="block text-xs text-fg-subtle">{f.help}</span>}
        </span>
      </label>
    );
  }

  return (
    <div className={spanClass}>
      <label className="label" htmlFor={f.name}>
        {f.label}
        {!f.required && (
          <span className="font-normal text-fg-subtle"> (optional)</span>
        )}
      </label>

      {type === "select" ? (
        <select
          id={f.name}
          name={f.name}
          required={f.required}
          defaultValue={(f.defaultValue as string) ?? ""}
          className="input"
          aria-invalid={invalid}
        >
          {!f.required && <option value="">{f.placeholder ?? "— none —"}</option>}
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : type === "textarea" ? (
        <textarea
          id={f.name}
          name={f.name}
          required={f.required}
          rows={f.rows ?? 3}
          placeholder={f.placeholder}
          defaultValue={(f.defaultValue as string) ?? ""}
          className="input"
          aria-invalid={invalid}
        />
      ) : (
        <input
          id={f.name}
          name={f.name}
          type={type}
          required={f.required}
          placeholder={f.placeholder}
          step={f.step}
          min={f.min}
          max={f.max}
          defaultValue={(f.defaultValue as string | number) ?? ""}
          className={cn("input", type === "number" && "tnum")}
          aria-invalid={invalid}
        />
      )}

      <FieldError errors={errors} name={f.name} />
      {f.help && <p className="help">{f.help}</p>}
    </div>
  );
}
