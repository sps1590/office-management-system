"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Must live inside the <form> it submits — useFormStatus reads the nearest
 * form's pending state, which is what disables the button for the duration of
 * the Server Action without any local state.
 */
export default function SubmitButton({
  children,
  className = "btn btn-primary",
  pendingLabel,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn("btn", className)}>
      {pending && <Loader2 size={15} className="animate-spin" />}
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
