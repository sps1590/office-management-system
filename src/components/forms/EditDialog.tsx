"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import AutoForm, { type FieldSpec } from "./AutoForm";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/types";

/**
 * Edit one row, in place, without a page of its own.
 *
 * Most master data in this product — a department, a room, a leave type —
 * is three or four fields. Giving each one a `/thing/[id]/edit` route would
 * mean a navigation, a page, a loader and a way back for every one of them.
 * This is the same `AutoForm`, with the record's current values as defaults,
 * in the native `<dialog>` the leave calendar already uses.
 *
 * It closes itself on success, because the row behind it has just been
 * revalidated and the new values are what the person wants to look at.
 */
export default function EditDialog({
  title,
  action,
  fields,
  hidden,
  label,
  columns = 1,
  triggerClassName,
  submitLabel = "Save changes",
}: {
  title: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  fields: FieldSpec[];
  /** The record's id, and anything else the action needs. */
  hidden: Record<string, string>;
  /** Button text. Omitted, the trigger is an icon-only pencil. */
  label?: string;
  columns?: 1 | 2 | 3;
  triggerClassName?: string;
  submitLabel?: string;
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
        className={cn("btn btn-ghost", label ? "btn-sm" : "btn-icon", triggerClassName)}
        aria-label={label ? undefined : title}
        title={label ? undefined : title}
      >
        <Pencil size={14} />
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
        {/* Mounted only while open, so every opening starts from the row's
            current values rather than whatever was typed and abandoned last
            time. */}
        {open && (
          <>
            <div className="card-head">
              <h2 className="card-title">{title}</h2>
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
                action={action}
                fields={fields}
                hidden={hidden}
                columns={columns}
                submitLabel={submitLabel}
                onSuccess={() => setOpen(false)}
              />
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
