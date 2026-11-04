"use client";

import { useActionState } from "react";
import SubmitButton from "./SubmitButton";
import type { ActionState } from "@/lib/types";

/**
 * A single-purpose button that posts a Server Action with fixed values —
 * approve, reject, cancel, change status, mark received.
 *
 * It keeps its own action state so a refusal ("you cannot approve your own
 * request") is shown next to the button that caused it, instead of being
 * swallowed the way a bare `<form action={…}>` would swallow it.
 */
export default function ActionButton({
  action,
  values,
  label,
  className = "btn-secondary btn-sm",
  pendingLabel,
  confirm,
  icon,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  values: Record<string, string>;
  label: string;
  className?: string;
  pendingLabel?: string;
  /** When set, the browser asks this before submitting. */
  confirm?: string;
  icon?: React.ReactNode;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (confirm && !window.confirm(confirm)) e.preventDefault();
        }}
      >
        {Object.entries(values).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <SubmitButton className={className} pendingLabel={pendingLabel}>
          {icon}
          {label}
        </SubmitButton>
      </form>
      {state?.error && <span className="field-error">{state.error}</span>}
      {state?.success && <span className="text-xs text-success">{state.success}</span>}
    </span>
  );
}
