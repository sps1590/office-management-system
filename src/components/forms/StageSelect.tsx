"use client";

import { useActionState, useEffect, useRef } from "react";
import { moveDealAction } from "@/lib/actions/crm";
import type { ActionState } from "@/lib/types";

/**
 * The stage picker on a pipeline card. Submits as soon as the value changes,
 * so moving a deal is one interaction rather than select-then-click.
 *
 * A dropdown rather than drag-and-drop: it works on a phone, with a keyboard
 * and with a screen reader, which HTML5 drag-and-drop does not.
 */
export default function StageSelect({
  dealId,
  stageId,
  stages,
}: {
  dealId: string;
  stageId: string | null;
  stages: { id: string; name: string }[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(moveDealAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Surface a refusal (for example a stage from another tenant) rather than
  // leaving the card looking as though it moved.
  useEffect(() => {
    if (state?.error) formRef.current?.reset();
  }, [state?.error]);

  return (
    <form action={action} ref={formRef}>
      <input type="hidden" name="dealId" value={dealId} />
      <select
        name="stageId"
        defaultValue={stageId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="input btn-sm !py-1 text-xs"
        aria-label="Move deal to stage"
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {state?.error && <p className="field-error">{state.error}</p>}
    </form>
  );
}
