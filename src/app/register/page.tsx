import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import RegisterForm from "@/components/forms/RegisterForm";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Register your company" };

export default async function RegisterPage() {
  if (await getSessionUser()) redirect("/dashboard");

  return (
    <AuthShell
      title="Register your company"
      subtitle="Creates an isolated workspace and makes you its company admin."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-semibold hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
