import type { Metadata } from "next";
import { PauseCircle } from "lucide-react";
import { logoutAction } from "@/lib/actions/auth";
import SubmitButton from "@/components/SubmitButton";
import Logo from "@/components/Logo";

export const metadata: Metadata = { title: "Account suspended" };

export default function SuspendedPage() {
  return (
    <div className="min-h-dvh grid place-items-center p-6">
      <div className="card max-w-md w-full p-8 text-center fade-up">
        <div className="flex justify-center mb-5">
          <Logo size={34} />
        </div>
        <PauseCircle size={34} className="mx-auto text-warning" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          This workspace is suspended
        </h1>
        <p className="mt-2 text-sm text-fg-muted leading-relaxed">
          Your company&apos;s OMS account has been paused, so data access is
          temporarily disabled. Nothing has been deleted. Please contact your
          company administrator or the platform operator to restore access.
        </p>
        <form action={logoutAction} className="mt-6">
          <SubmitButton className="btn-secondary w-full">Sign out</SubmitButton>
        </form>
      </div>
    </div>
  );
}
