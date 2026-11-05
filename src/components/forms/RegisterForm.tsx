"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { registerAction } from "@/lib/actions/auth";
import SubmitButton from "@/components/SubmitButton";
import FieldError from "@/components/FieldError";
import { usePreservedForm } from "./usePreservedForm";
import type { ActionState } from "@/lib/types";

const CURRENCIES = ["BDT", "USD", "EUR", "GBP", "INR", "AED", "SAR", "MYR", "SGD"];

export default function RegisterForm() {
  const [state, action] = useActionState<ActionState, FormData>(registerAction, null);
  const preserved = usePreservedForm(state);
  const fe = state?.fieldErrors;

  return (
    <form action={action} className="space-y-4" {...preserved}>
      {/* The browser already knows where this company is, and every date in
          the app is rendered through the zone chosen here. Sending it saves
          an office outside Bangladesh from running on Dhaka time until
          someone notices; Settings can change it afterwards. The server
          validates it and falls back to the default on anything odd. */}
      <input
        type="hidden"
        name="timezone"
        value={Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""}
      />
      {state?.error && (
        <div className="alert alert-error flex items-start gap-2" role="alert">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <div>
        <label className="label" htmlFor="companyName">
          Company name
        </label>
        <input
          id="companyName"
          name="companyName"
          required
          autoFocus
          placeholder="Acme Industries Ltd."
          className="input"
          aria-invalid={!!fe?.companyName}
        />
        <FieldError errors={fe} name="companyName" />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="adminName">
            Your full name
          </label>
          <input
            id="adminName"
            name="adminName"
            required
            autoComplete="name"
            placeholder="Shahriar Parvez"
            className="input"
            aria-invalid={!!fe?.adminName}
          />
          <FieldError errors={fe} name="adminName" />
        </div>
        <div>
          <label className="label" htmlFor="phone">
            Phone <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <input
            id="phone"
            name="phone"
            autoComplete="tel"
            placeholder="+880 1XXX-XXXXXX"
            className="input"
          />
          <FieldError errors={fe} name="phone" />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          className="input"
          aria-invalid={!!fe?.email}
        />
        <FieldError errors={fe} name="email" />
        <p className="help">You will sign in with this address as the company admin.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="country">
            Country <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <input
            id="country"
            name="country"
            placeholder="Bangladesh"
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="currency">
            Currency
          </label>
          <select id="currency" name="currency" className="input" defaultValue="BDT">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            className="input"
            aria-invalid={!!fe?.password}
          />
          <FieldError errors={fe} name="password" />
        </div>
        <div>
          <label className="label" htmlFor="confirmPassword">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            className="input"
            aria-invalid={!!fe?.confirmPassword}
          />
          <FieldError errors={fe} name="confirmPassword" />
        </div>
      </div>
      <p className="help">
        At least 8 characters, with an upper-case letter, a lower-case letter and a
        number.
      </p>

      <SubmitButton className="btn-primary w-full" pendingLabel="Creating your workspace…">
        Create company workspace
      </SubmitButton>

      <p className="text-xs text-fg-subtle leading-relaxed">
        Your company gets its own isolated workspace with the ten standard roles
        pre-configured, a chart of accounts, leave types and a sales pipeline ready
        to use.
      </p>
    </form>
  );
}
