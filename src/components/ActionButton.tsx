"use client";

import { useActionState } from "react";
import SubmitButton from "./SubmitButton";
import { toast } from "./Toast";
import type { ActionState } from "@/lib/types";

/**
 * A single-purpose button that posts a Server Action with fixed values —
 * approve, reject, cancel, change status, mark received.
 *
 * It keeps its own action state so a refusal ("you cannot approve your own
 * request") is shown next to the button that caused it, instead of being
 * swallowed the way a bare `<form action={…}>` would swallow it.
 *
 * A refusal leaves the record alone, so this button is still on screen to
 * show it. A success usually is not: the new status renders a different set
 * of buttons, and this button unmounts in the very commit that delivers its
 * own success. An effect here would never run, so the toast is raised inside
 * the action instead, while the component is still alive, and displayed by
 * the toaster in `AppShell`, which outlives the re-render.
 */
export default function ActionButton({
  action,
  values,
  label,
  className = "btn-secondary btn-sm",
  pendingLabel,
  confirm,
  icon,
  title,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  values: Record<string, string>;
  label: string;
  className?: string;
  pendingLabel?: string;
  /** When set, the browser asks this before submitting. */
  confirm?: string;
  icon?: React.ReactNode;
  /** The accessible name when `label` is empty and only an icon shows. */
  title?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev: ActionState, formData: FormData) => {
      const result = await action(prev, formData);
      if (result?.success) toast(result.success);
      return result;
    },
    null
  );

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
        <SubmitButton className={className} pendingLabel={pendingLabel} label={title}>
          {icon}
          {label}
        </SubmitButton>
      </form>
      {state?.error && <span className="field-error">{state.error}</span>}
    </span>
  );
}
