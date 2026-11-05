"use client";

import { useSyncExternalStore } from "react";
import { CheckCircle2, X } from "lucide-react";

/**
 * Confirmations that outlive the control that raised them.
 *
 * A lifecycle action usually removes its own button: submitting a purchase
 * order replaces "Submit for approval" with "Receive into stock", cancelling
 * a booking takes the cancel button away. The `useActionState` holding the
 * success message unmounts with that button, so the message was never seen.
 *
 * The queue therefore lives in this module rather than in component state.
 * The server re-render that follows a `revalidatePath` can remount the
 * toaster, and anything held in `useState` goes with it — which is exactly
 * the moment a confirmation is needed. `useSyncExternalStore` re-reads the
 * module queue after such a remount, so the toast survives it.
 */
type ToastItem = { id: number; message: string };

let items: ToastItem[] = [];
let nextId = 1;
const subscribers = new Set<() => void>();

function emit() {
  for (const notify of subscribers) notify();
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

function dismiss(id: number) {
  items = items.filter((i) => i.id !== id);
  emit();
}

export function toast(message: string) {
  const item = { id: nextId++, message };
  items = [...items, item];
  emit();
  // Each toast carries its own timer, so one arriving later never cuts an
  // earlier one short.
  setTimeout(() => dismiss(item.id), 6000);
}

const EMPTY: ToastItem[] = [];
const getSnapshot = () => items;
/** Nothing can have been raised during a server render. */
const getServerSnapshot = () => EMPTY;

export function Toaster() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    // The region stays in the document: a live region inserted at the same
    // moment as its content is not announced by screen readers.
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[min(24rem,calc(100vw-2rem))] pointer-events-none empty:hidden"
      role="status"
      aria-live="polite"
    >
      {current.map((t) => (
        <div
          key={t.id}
          className="alert alert-success fade-up shadow-lg flex items-start gap-2 pointer-events-auto"
        >
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
            onClick={() => dismiss(t.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
