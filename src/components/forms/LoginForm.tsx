"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { loginAction } from "@/lib/actions/auth";
import SubmitButton from "@/components/SubmitButton";
import FieldError from "@/components/FieldError";
import { usePreservedForm } from "./usePreservedForm";
import type { ActionState } from "@/lib/types";

export default function LoginForm() {
  const [state, action] = useActionState<ActionState, FormData>(loginAction, null);
  const preserved = usePreservedForm(state);

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
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          className="input"
          aria-invalid={!!state?.fieldErrors?.password}
        />
        <FieldError errors={state?.fieldErrors} name="password" />
      </div>

      <SubmitButton className="btn-primary w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
