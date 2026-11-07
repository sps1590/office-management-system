import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import ForgotPasswordForm from "@/components/forms/ForgotPasswordForm";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Forgot password",
  // A reset page has no business in a search index.
  robots: { index: false, follow: false },
};

export default async function ForgotPasswordPage() {
  // Somebody already signed in wants /me, where changing a password needs
  // the current one — not a mailbox round trip.
  if (await getSessionUser()) redirect("/me");

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your work email and we will send you a link to choose a new one."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="text-primary font-semibold hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
