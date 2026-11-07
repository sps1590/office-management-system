"use client";

import { useActionState } from "react";
import { AlertCircle, CalendarDays, CheckCircle2, Plus } from "lucide-react";
import SubmitButton from "@/components/SubmitButton";
import FieldError from "@/components/FieldError";
import DayCheckboxes from "./DayCheckboxes";
import { usePreservedForm } from "./usePreservedForm";
import type { ActionState } from "@/lib/types";

/**
 * The two forms that need a day picker, which `AutoForm`'s field spec has no
 * type for — seven checkboxes sharing one name is not a field, it is a
 * fieldset, and adding it to AutoForm for two callers would have been the
 * wrong trade.
 *
 * Both follow every other form in the product: `useActionState`, the shared
 * `SubmitButton`, `usePreservedForm` so a refusal does not empty the inputs,
 * and the `.card` / `.input` / `.label` classes.
 */

function Alerts({ state }: { state: ActionState }) {
  return (
    <>
      {state?.error && (
        <div className="alert alert-error mt-3">
          <AlertCircle size={16} />
          <span>{state.error}</span>
        </div>
      )}
      {state?.success && (
        <div className="alert alert-success mt-3">
          <CheckCircle2 size={16} />
          <span>{state.success}</span>
        </div>
      )}
    </>
  );
}

export function WorkingWeekForm({
  action,
  workingDays,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  workingDays: number[];
}) {
  const [state, formAction] = useActionState(action, null);
  const preserved = usePreservedForm(state);

  return (
    <form action={formAction} {...preserved}>
      <DayCheckboxes
        selected={workingDays}
        legend="Days the company works"
        help="Everything unticked is a rest day: no hours are expected on it, so it never counts as a shortfall on anybody's timesheet. A shift can override this for the people on it."
      />
      <div className="mt-4">
        <SubmitButton className="btn-primary" pendingLabel="Saving…">
          <CalendarDays size={15} />
          Save working week
        </SubmitButton>
      </div>
      <Alerts state={state} />
    </form>
  );
}

export function ShiftForm({
  action,
  defaultDays,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaultDays: number[];
}) {
  const [state, formAction] = useActionState(action, null);
  const preserved = usePreservedForm(state);
  const err = state?.fieldErrors;

  return (
    <form action={formAction} {...preserved} className="grid gap-3">
      <div>
        <label className="label" htmlFor="shift-name">
          Shift name
        </label>
        <input
          id="shift-name"
          name="name"
          required
          maxLength={60}
          placeholder="Night shift"
          className="input"
        />
        <FieldError errors={err} name="name" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="shift-start">
            Starts at
          </label>
          <input id="shift-start" name="startTime" type="time" required defaultValue="09:00" className="input" />
          <FieldError errors={err} name="startTime" />
        </div>
        <div>
          <label className="label" htmlFor="shift-end">
            Ends at
          </label>
          <input id="shift-end" name="endTime" type="time" required defaultValue="17:00" className="input" />
          <FieldError errors={err} name="endTime" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="shift-break">
            Unpaid break (minutes)
          </label>
          <input
            id="shift-break"
            name="breakMinutes"
            type="number"
            min={0}
            max={480}
            defaultValue={60}
            className="input"
          />
          <FieldError errors={err} name="breakMinutes" />
        </div>
        <div>
          <label className="label" htmlFor="shift-grace">
            Late grace (minutes)
          </label>
          <input
            id="shift-grace"
            name="graceMinutes"
            type="number"
            min={0}
            max={240}
            placeholder="company default"
            className="input"
          />
          <FieldError errors={err} name="graceMinutes" />
        </div>
      </div>

      <DayCheckboxes
        selected={defaultDays}
        legend="Days this shift works"
        help="An end time at or before the start means the shift crosses midnight — 22:00 to 06:00 counts as eight hours, not minus sixteen."
      />

      <div>
        <SubmitButton className="btn-primary" pendingLabel="Creating…">
          <Plus size={15} />
          Create shift
        </SubmitButton>
      </div>
      <Alerts state={state} />
    </form>
  );
}
