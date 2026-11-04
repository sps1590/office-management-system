"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { LogIn, LogOut, MapPin, MapPinOff } from "lucide-react";
import { checkInAction, checkOutAction } from "@/lib/actions/attendance";
import SubmitButton from "./SubmitButton";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/types";

/**
 * Attendance check-in / check-out with the browser's coordinate attached.
 *
 * The coordinate is a hidden input rather than something the action fetches,
 * because only the client can read it — but the *decision* about whether it
 * falls inside an office geofence is made on the server, so a forged
 * coordinate still has to land inside a real fence to be accepted.
 */
export default function CheckInWidget({
  checkedInAt,
  checkedOutAt,
  workedMinutes,
  requiresLocation,
}: {
  checkedInAt: string | null;
  checkedOutAt: string | null;
  workedMinutes: number;
  requiresLocation: boolean;
}) {
  const mode = !checkedInAt ? "in" : !checkedOutAt ? "out" : "done";
  const [state, action] = useActionState<ActionState, FormData>(
    mode === "in" ? checkInAction : checkOutAction,
    null
  );

  const [coords, setCoords] = useState<GeolocationCoordinates | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  // Ask for the position as soon as the widget mounts, so the button is ready
  // the moment the user wants it rather than pausing for a prompt mid-click.
  useEffect(() => {
    if (mode === "done" || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords(pos.coords);
        setGeoError(null);
      },
      (err) => setGeoError(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 }
    );
  }, [mode]);

  // Live "time at work" counter while checked in.
  useEffect(() => {
    if (mode !== "out" || !checkedInAt) return;
    const start = new Date(checkedInAt).getTime();
    const tick = () => {
      const m = Math.max(0, Math.floor((Date.now() - start) / 60_000));
      setElapsed(`${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [mode, checkedInAt]);

  const time = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : "—";

  if (mode === "done") {
    return (
      <div className="card p-5">
        <p className="text-[0.8125rem] font-medium text-fg-muted">Today&apos;s attendance</p>
        <p className="kpi-value mt-2.5">
          {Math.floor(workedMinutes / 60)}h {workedMinutes % 60}m
        </p>
        <p className="mt-1 text-xs text-fg-subtle">
          In {time(checkedInAt)} · Out {time(checkedOutAt)} · Complete
        </p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8125rem] font-medium text-fg-muted">
          {mode === "in" ? "Not checked in yet" : "Checked in"}
        </p>
        <span
          className={cn(
            "badge",
            coords ? "badge-success" : geoError ? "badge-warning" : "badge-neutral"
          )}
          title={
            coords
              ? `Accurate to about ${Math.round(coords.accuracy)} m`
              : geoError === "denied"
                ? "Location permission denied"
                : "Locating…"
          }
        >
          {coords ? <MapPin size={12} /> : <MapPinOff size={12} />}
          {coords ? "Located" : geoError ? "No location" : "Locating…"}
        </span>
      </div>

      <p className="kpi-value mt-2.5">{mode === "in" ? time(null) : elapsed || "0h 00m"}</p>
      <p className="mt-1 text-xs text-fg-subtle">
        {mode === "in"
          ? "Check in to start recording today"
          : `Since ${time(checkedInAt)}`}
      </p>

      {state?.error && <p className="field-error mt-3">{state.error}</p>}
      {state?.success && <p className="mt-3 text-xs text-success">{state.success}</p>}
      {!coords && geoError === "denied" && requiresLocation && (
        <p className="help mt-2">
          Your company requires a location to check in. Enable location access for this
          site in your browser settings.
        </p>
      )}

      <form action={action} ref={formRef} className="mt-4">
        <input type="hidden" name="latitude" value={coords?.latitude ?? ""} />
        <input type="hidden" name="longitude" value={coords?.longitude ?? ""} />
        <input type="hidden" name="accuracy" value={coords?.accuracy ?? ""} />
        <SubmitButton
          className={cn("w-full", mode === "in" ? "btn-primary" : "btn-secondary")}
          pendingLabel="Recording…"
        >
          {mode === "in" ? <LogIn size={15} /> : <LogOut size={15} />}
          {mode === "in" ? "Check in" : "Check out"}
        </SubmitButton>
      </form>
    </div>
  );
}
