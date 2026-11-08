"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound, X } from "lucide-react";
import AutoForm from "./AutoForm";
import { resetUserPasswordAction } from "@/lib/actions/employees";
import { cn } from "@/lib/utils";

/**
 * A company admin setting somebody else's password.
 *
 * Two routes behind one control. Typing a password is the one that matches
 * what actually happens — the person is at the desk and a new password is
 * agreed out loud — and leaving the field blank generates one and shows it
 * once. The generated one is shown because nobody knows it yet; a typed one
 * is not echoed back, because the administrator just typed it.
 *
 * Deliberately not closed on success: the generated password appears in the
 * success message, and a dialog that shut itself would take the only copy
 * with it.
 */
export default function SetPasswordDialog({
  userId,
  name,
  /** Omitted, the trigger is an icon-only key, for a table row. */
  label,
  className,
}: {
  userId: string;
  name: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("btn", className ?? (label ? "btn-secondary" : "btn-ghost btn-icon"))}
        aria-label={label ? undefined : `Set a password for ${name}`}
        title={label ? undefined : `Set a password for ${name}`}
      >
        <KeyRound size={label ? 15 : 14} />
        {label}
      </button>

      <dialog
        ref={dialog}
        className="sheet"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialog.current) setOpen(false);
        }}
      >
        {open && (
          <>
            <div className="card-head">
              <h2 className="card-title">Set a password for {name}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn btn-ghost btn-icon"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5">
              <AutoForm
                action={resetUserPasswordAction}
                hidden={{ userId }}
                columns={1}
                submitLabel="Set password"
                fields={[
                  {
                    name: "password",
                    label: "New password",
                    type: "password",
                    placeholder: "Leave blank to generate one",
                    help:
                      "At least 8 characters, with upper case, lower case and a number. " +
                      "Leave it empty and the system will generate one and show it once.",
                  },
                ]}
              />
              <p className="help mt-4">
                Either way, every session this person has open is signed out, so they
                must sign in again with the new password. Ask them to change it on their
                own profile afterwards, where the current one has to be entered.
              </p>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
