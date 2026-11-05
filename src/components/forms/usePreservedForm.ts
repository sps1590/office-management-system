"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ActionState } from "@/lib/types";

/**
 * Keeps what someone typed when a submission comes back rejected.
 *
 * React resets an uncontrolled form once its action completes — on a refusal
 * as well as on a success. Without this, one invalid field emptied the whole
 * form, which on the employee or purchase-order screens throws away a few
 * minutes of typing to report a single mistake.
 *
 * The values are captured on submit, before the reset, and written back after
 * the commit that carried the error. Password fields are deliberately left
 * out: a password is never held in client memory here, and browsers do not
 * restore them either. Controlled fields look after themselves and are
 * unaffected.
 *
 * Returns the ref to put on the `<form>` and the `onSubmit` that captures.
 */
export function usePreservedForm(state: ActionState) {
  const ref = useRef<HTMLFormElement>(null);
  const snapshot = useRef<string[] | null>(null);

  const fields = (form: HTMLFormElement) =>
    Array.from(form.elements).filter((el): el is HTMLInputElement => {
      const field = el as HTMLInputElement;
      return (
        !!field.name &&
        !field.name.startsWith("$") &&
        field.type !== "password" &&
        field.type !== "hidden" &&
        field.type !== "file" &&
        field.type !== "submit"
      );
    });

  const capture = useCallback(() => {
    const form = ref.current;
    if (!form) return;
    snapshot.current = fields(form).map((f) =>
      f.type === "checkbox" || f.type === "radio" ? (f.checked ? "1" : "") : f.value
    );
  }, []);

  const rejected = !!state?.error || !!state?.fieldErrors;

  useEffect(() => {
    if (!rejected) {
      snapshot.current = null;
      return;
    }
    const values = snapshot.current;
    const form = ref.current;
    if (!values || !form) return;

    // After the commit, so the restore lands on top of React's own reset
    // rather than under it.
    const frame = requestAnimationFrame(() => {
      const current = fields(form);
      if (current.length !== values.length) return;
      current.forEach((field, i) => {
        if (field.type === "checkbox" || field.type === "radio") {
          field.checked = values[i] === "1";
        } else {
          field.value = values[i];
        }
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [rejected, state]);

  return { ref, onSubmit: capture };
}
