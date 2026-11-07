import type { Metadata } from "next";
import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import ResetPasswordForm from "@/components/forms/ResetPasswordForm";
import { resetTokenIsLive } from "@/lib/password-reset";

export const metadata: Metadata = {
  title: "Choose a new password",
  // Never indexed, and never sent as a referrer: a reset token in the query
  // string must not travel to whatever the page links out to.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token ?? "";

  /*
     Checked before the form is drawn, so a link that expired in somebody's
     inbox says so rather than taking a password they have already chosen
     and then refusing it. The check is read-only — the token is spent by
     the action, not by looking at this page, or a mail client's link
     preview would burn it on arrival.
  */
  const live = token ? await resetTokenIsLive(token) : false;

  if (!live) {
    return (
      <AuthShell
        title="This link has expired"
        subtitle="Reset links work once and last an hour. Ask for a fresh one and it will arrive in a moment."
      >
        <div className="space-y-3">
          <Link href="/forgot-password" className="btn btn-primary w-full">
            Send me a new link
          </Link>
          <Link href="/login" className="btn btn-secondary w-full">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Signing in anywhere else will stop, so pick something you will remember."
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
