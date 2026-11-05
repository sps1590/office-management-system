"use client";

import { useActionState, useEffect, useState } from "react";
import { MapPin, MapPinOff } from "lucide-react";
import SubmitButton from "./SubmitButton";
import { usePreservedForm } from "./forms/usePreservedForm";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/types";

/**
 * A form that attaches the browser's current coordinate to its submission —
 * used wherever the SRS asks for proof of presence (field-visit check-in and
 * check-out, GPS-stamped task completion).
 *
 * Only the client can read the position, so it travels as a hidden input; the
 * server decides what it means (distance to the client's address, whether the
 * visit counts as verified), which is why a forged coordinate gains nothing.
 */
export default function GeoActionForm({
  action,
  hidden,
  submitLabel,
  pendingLabel,
  className = "btn-primary btn-sm",
  children,
  required = true,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  hidden?: Record<string, string>;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  /** Extra fields rendered above the button (outcome, notes…). */
  children?: React.ReactNode;
  required?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const preserved = usePreservedForm(state);
  const [coords, setCoords] = useState<GeolocationCoordinates | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords(pos.coords),
      () => setDenied(true),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 }
    );
  }, []);

  return (
    <form action={formAction} className="space-y-3" {...preserved}>
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="latitude" value={coords?.latitude ?? ""} />
      <input type="hidden" name="longitude" value={coords?.longitude ?? ""} />

      {children}

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton className={className} pendingLabel={pendingLabel}>
          {submitLabel}
        </SubmitButton>
        <span
          className={cn(
            "badge",
            coords ? "badge-success" : denied ? "badge-warning" : "badge-neutral"
          )}
          title={
            coords
              ? `Accurate to about ${Math.round(coords.accuracy)} m`
              : denied
                ? "Location unavailable"
                : "Locating…"
          }
        >
          {coords ? <MapPin size={12} /> : <MapPinOff size={12} />}
          {coords
            ? `±${Math.round(coords.accuracy)} m`
            : denied
              ? "No location"
              : "Locating…"}
        </span>
      </div>

      {denied && required && (
        <p className="help">
          A coordinate is required here. Allow location access for this site, then
          reload.
        </p>
      )}
      {state?.error && <p className="field-error">{state.error}</p>}
      {state?.success && <p className="text-xs text-success">{state.success}</p>}
    </form>
  );
}
