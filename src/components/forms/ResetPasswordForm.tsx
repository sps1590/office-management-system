"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { resetPasswordAction } from "@/lib/actions/auth";
import SubmitButton from "@/components/SubmitButton";
import FieldError from "@/components/FieldError";
import { usePreservedForm } from "./usePreservedForm";
import type { ActionState } from "@/lib/types";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState<ActionState, FormData>(resetPasswordAction, null);
  const preserved = usePreservedForm(state);

  return (
    <form action={action} className="space-y-4" {...preserved}>
      {state?.error && (
        <div className="alert alert-error flex items-start gap-2" role="alert">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            {state.error}{" "}
            <Link href="/forgot-password" className="font-semibold underline">
              Request a new link
            </Link>
          </span>
        </div>
      )}

      {/* The token travels with the submission rather than being read from
          the URL on the server: the action is a POST to an endpoint of its
          own, which carries no query string. */}
      <input type="hidden" name="token" value={token} />

      <div>
        <label className="label" htmlFor="password">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          placeholder="••••••••"
          className="input"
          aria-invalid={!!state?.fieldErrors?.password}
        />
        <FieldError errors={state?.fieldErrors} name="password" />
        <p className="help mt-2">
          At least 8 characters, with upper case, lower case and a number.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="confirmPassword">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          placeholder="••••••••"
          className="input"
          aria-invalid={!!state?.fieldErrors?.confirmPassword}
        />
        <FieldError errors={state?.fieldErrors} name="confirmPassword" />
      </div>

      <SubmitButton className="btn-primary w-full" pendingLabel="Saving…">
        Set new password
      </SubmitButton>
    </form>
  );
}
