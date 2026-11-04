"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, MapPin, Pause, Play, Satellite, WifiOff } from "lucide-react";
import { enrolBrowserAction } from "@/lib/actions/tracking";
import { cn } from "@/lib/utils";

/**
 * The PWA tracker (docs/MOBILE.md §2.4).
 *
 * It enrols this browser as a tracking device, then streams coordinates to the
 * same `/api/telemetry/locations` endpoint a native client uses — which means
 * the whole server pipeline is exercised by real traffic today.
 *
 * Honest limitation, stated on screen: a browser suspends timers when the tab
 * is backgrounded, so this reports only while the page is open and the screen
 * is on. Continuous background tracking needs the native client.
 */

type Status = "idle" | "starting" | "tracking" | "paused" | "error";

type Sent = { at: number; lat: number; lng: number; accuracy: number };

export default function TrackerClient({ intervalSeconds }: { intervalSeconds: number }) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [queued, setQueued] = useState(0);
  const [last, setLast] = useState<Sent | null>(null);
  const [activity, setActivity] = useState("In-Transit");
  const [online, setOnline] = useState(true);

  const tokenRef = useRef<string | null>(null);
  const watchRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestRef = useRef<GeolocationCoordinates | null>(null);
  // Points that could not be sent yet. Flushed in one batch when the network
  // returns, which is exactly what the ingest endpoint is built for.
  const queueRef = useRef<
    { latitude: number; longitude: number; log_timestamp: string; accuracy_meters: number }[]
  >([]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const flush = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;

    const current = latestRef.current;
    if (current) {
      queueRef.current.push({
        latitude: current.latitude,
        longitude: current.longitude,
        log_timestamp: new Date().toISOString(),
        accuracy_meters: current.accuracy,
      });
    }
    if (queueRef.current.length === 0) return;

    const batch = queueRef.current.slice(0, 500);
    try {
      const res = await fetch("/api/telemetry/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          points: batch.map((p) => ({ ...p, activity_state: activity })),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { accepted: number };
      queueRef.current = queueRef.current.slice(batch.length);
      setQueued(queueRef.current.length);
      setSentCount((c) => c + json.accepted);
      if (current) {
        setLast({
          at: Date.now(),
          lat: current.latitude,
          lng: current.longitude,
          accuracy: current.accuracy,
        });
      }
      setMessage(null);
    } catch {
      // Keep the batch queued and try again on the next tick.
      setQueued(queueRef.current.length);
      setMessage("Could not reach the server — points are queued and will be sent.");
    }
  }, [activity]);

  async function start() {
    setStatus("starting");
    setMessage(null);

    const result = await enrolBrowserAction();
    if (result.error || !result.token) {
      setStatus("error");
      setMessage(result.error ?? "Could not enrol this device.");
      return;
    }
    tokenRef.current = result.token;

    if (!("geolocation" in navigator)) {
      setStatus("error");
      setMessage("This browser cannot report a location.");
      return;
    }

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        latestRef.current = pos.coords;
        setStatus("tracking");
      },
      (err) => {
        setStatus("error");
        setMessage(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Allow it for this site and try again."
            : "Location is unavailable right now."
        );
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    );

    const everyMs = Math.max(15, result.intervalSeconds ?? intervalSeconds) * 1000;
    timerRef.current = setInterval(() => void flush(), everyMs);
    void flush();
  }

  function stop() {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    watchRef.current = null;
    timerRef.current = null;
    setStatus("paused");
  }

  useEffect(
    () => () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    },
    []
  );

  const tracking = status === "tracking";

  return (
    <div className="space-y-4">
      <div className="card p-6 text-center">
        <div
          className={cn(
            "mx-auto grid place-items-center h-20 w-20 rounded-full mb-4",
            tracking ? "bg-success-soft text-success" : "bg-surface-hover text-fg-subtle"
          )}
        >
          {tracking ? (
            <span className="relative">
              <Satellite size={30} />
              <span className="live-dot absolute -top-1 -right-1" />
            </span>
          ) : (
            <Satellite size={30} />
          )}
        </div>

        <p className="text-lg font-semibold tracking-tight">
          {status === "idle" && "Tracking is off"}
          {status === "starting" && "Starting…"}
          {status === "tracking" && "Reporting your position"}
          {status === "paused" && "Tracking paused"}
          {status === "error" && "Tracking stopped"}
        </p>
        <p className="mt-1.5 text-sm text-fg-muted">
          {tracking
            ? `Sending a coordinate about every ${intervalSeconds} seconds while this page is open.`
            : "Start tracking at the beginning of your shift."}
        </p>

        {message && <p className="alert alert-warning mt-4 text-left">{message}</p>}

        <div className="mt-5 flex items-center justify-center gap-2">
          {!tracking ? (
            <button onClick={() => void start()} className="btn btn-primary" disabled={status === "starting"}>
              <Play size={16} />
              Start tracking
            </button>
          ) : (
            <button onClick={stop} className="btn btn-secondary">
              <Pause size={16} />
              Pause
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="text-xs text-fg-muted">Points sent</p>
          <p className="kpi-value mt-1">{sentCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-fg-muted">Queued</p>
          <p className="kpi-value mt-1">{queued}</p>
        </div>
      </div>

      <div className="card p-5">
        <label className="label" htmlFor="activity">
          What are you doing?
        </label>
        <select
          id="activity"
          value={activity}
          onChange={(e) => setActivity(e.target.value)}
          className="input"
        >
          {["In-Transit", "Client-Meeting", "Idle", "Walking", "Driving", "Stationary"].map(
            (a) => (
              <option key={a} value={a}>
                {a.replace(/-/g, " ")}
              </option>
            )
          )}
        </select>
        <p className="help">
          Stored with each coordinate so the operations map shows what a stationary
          marker means.
        </p>
      </div>

      {last && (
        <div className="card p-5">
          <p className="text-[0.8125rem] font-semibold mb-2.5 flex items-center gap-1.5">
            <MapPin size={14} />
            Last reported position
          </p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-fg-muted">Latitude</dt>
              <dd className="tnum">{last.lat.toFixed(6)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Longitude</dt>
              <dd className="tnum">{last.lng.toFixed(6)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Accuracy</dt>
              <dd className="tnum">±{Math.round(last.accuracy)} m</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Sent</dt>
              <dd>{new Date(last.at).toLocaleTimeString("en-GB")}</dd>
            </div>
          </dl>
        </div>
      )}

      <div className="card p-5">
        <p className="text-[0.8125rem] font-semibold mb-2 flex items-center gap-1.5">
          <Activity size={14} />
          What this page can and cannot do
        </p>
        <ul className="text-sm text-fg-muted space-y-1.5 list-disc pl-5">
          <li>Reports only while this page is open and the screen is on.</li>
          <li>
            Points gathered without a network are queued and sent as one batch when it
            returns.
          </li>
          <li>
            Continuous background tracking with no prompt needs the native app
            distributed through your company&apos;s MDM.
          </li>
        </ul>
        {!online && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-warning">
            <WifiOff size={14} />
            Offline — queueing locally.
          </p>
        )}
      </div>
    </div>
  );
}
