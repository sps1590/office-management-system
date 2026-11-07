import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import LoginForm from "@/components/forms/LoginForm";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  // Already signed in — no reason to show the form again.
  if (await getSessionUser()) redirect("/dashboard");
  const justReset = (await searchParams).reset === "1";

  return (
    <AuthShell
      title="Sign in"
      subtitle="Use the work email your company administrator registered."
      footer={
        <>
          Registering a new company?{" "}
          <Link href="/register" className="text-primary font-semibold hover:underline">
            Create a workspace
          </Link>
        </>
      }
    >
      <LoginForm justReset={justReset} />
    </AuthShell>
  );
}
