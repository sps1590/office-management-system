"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { loginAction } from "@/lib/actions/auth";
import SubmitButton from "@/components/SubmitButton";
import FieldError from "@/components/FieldError";
import { usePreservedForm } from "./usePreservedForm";
import type { ActionState } from "@/lib/types";

export default function LoginForm({ justReset = false }: { justReset?: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(loginAction, null);
  const preserved = usePreservedForm(state);

  return (
    <form action={action} className="space-y-4" {...preserved}>
      {/* Shown once, after a reset redirects here. It disappears as soon as
          the form has anything of its own to say. */}
      {justReset && !state && (
        <div className="alert alert-success flex items-start gap-2" role="status">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>Your password has been changed. Sign in with the new one.</span>
        </div>
      )}

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
        <div className="flex items-baseline justify-between gap-3">
          <label className="label" htmlFor="password">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-[0.8125rem] text-primary font-medium hover:underline"
          >
            Forgot password?
          </Link>
        </div>
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
