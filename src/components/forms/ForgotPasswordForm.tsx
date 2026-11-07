"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { requestPasswordResetAction } from "@/lib/actions/auth";
import SubmitButton from "@/components/SubmitButton";
import FieldError from "@/components/FieldError";
import { usePreservedForm } from "./usePreservedForm";
import type { ActionState } from "@/lib/types";

export default function ForgotPasswordForm() {
  const [state, action] = useActionState<ActionState, FormData>(
    requestPasswordResetAction,
    null
  );
  const preserved = usePreservedForm(state);

  /*
     The success message replaces the form rather than sitting under it.
     Leaving the field there invites a second submission, and the second one
     invalidates the link the first just sent — which is the one already in
     their inbox.
  */
  if (state?.success) {
    return (
      <div className="alert alert-success flex items-start gap-2" role="status">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
        <span>{state.success}</span>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" {...preserved}>
      {state?.error && (
        <div className="alert alert-error flex items-start gap-2" role="alert">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <div>
        <label className="label" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="you@company.com"
          className="input"
          aria-invalid={!!state?.fieldErrors?.email}
        />
        <FieldError errors={state?.fieldErrors} name="email" />
        <p className="help mt-2">
          The link works once and expires in an hour.
        </p>
      </div>

      <SubmitButton className="btn-primary w-full" pendingLabel="Sending…">
        Email me a reset link
      </SubmitButton>
    </form>
  );
}
