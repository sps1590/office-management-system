"use client";

import { useEffect, useRef, useState } from "react";
import { LocateFixed, Search } from "lucide-react";
import FieldError from "@/components/FieldError";
import "leaflet/dist/leaflet.css";

/**
 * Picks a point by clicking a map, for the screens that need a latitude and a
 * longitude.
 *
 * Typing the two numbers was how this started, and it meant leaving the
 * product, finding the place in a mapping site, right-clicking it and copying
 * the pair back -- for every geofence, warehouse and client site. Leaflet is
 * already here for the operations map, so the map itself costs nothing new.
 *
 * The inputs stay uncontrolled and keep the names the action already expects,
 * so nothing behind the form changes, `usePreservedForm` still restores them
 * on a refusal and `resetOnSuccess` still clears them. The map writes into
 * them and reads back out of them; neither side owns the value.
 */

const DEFAULT_VIEW: [number, number] = [23.8103, 90.4125];

export default function LocationPicker({
  latName,
  lngName,
  radiusName,
  label,
  help,
  required,
  defaultLat,
  defaultLng,
  errors,
  height = 280,
}: {
  latName: string;
  lngName: string;
  /** Name of a radius input in the same form; its value sizes the ring. */
  radiusName?: string;
  label: string;
  help?: string;
  required?: boolean;
  defaultLat?: number | null;
  defaultLng?: number | null;
  errors?: Record<string, string[]>;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const circleRef = useRef<import("leaflet").Circle | null>(null);
  /** Set once Leaflet has loaded, so the buttons can move the pin. */
  const writeRef = useRef<((lat: number, lng: number, recentre: boolean) => void) | null>(
    null
  );

  const [status, setStatus] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cleanups: (() => void)[] = [];

    const readPoint = (): [number, number] | null => {
      const rawLat = latRef.current?.value ?? "";
      const rawLng = lngRef.current?.value ?? "";
      if (rawLat === "" || rawLng === "") return null;
      const lat = Number(rawLat);
      const lng = Number(rawLng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
      return [lat, lng];
    };

    const readRadius = (): number => {
      if (!radiusName) return 200;
      const el = latRef.current?.form?.elements.namedItem(radiusName);
      const n = Number((el as HTMLInputElement | null)?.value);
      return Number.isFinite(n) && n > 0 ? n : 200;
    };

    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current) return;

      const start = readPoint();
      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView(start ?? DEFAULT_VIEW, start ? 16 : 11);
      mapRef.current = map;

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);

      const icon = L.divIcon({
        className: "oms-pick-pin",
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      const draw = (at: [number, number] | null, recentre: boolean) => {
        if (!at) {
          markerRef.current?.remove();
          circleRef.current?.remove();
          markerRef.current = null;
          circleRef.current = null;
          return;
        }
        if (markerRef.current) {
          markerRef.current.setLatLng(at);
        } else {
          const marker = L.marker(at, { icon, draggable: true }).addTo(map);
          marker.on("dragend", () => {
            const p = marker.getLatLng();
            write(p.lat, p.lng, false);
          });
          markerRef.current = marker;
        }
        if (circleRef.current) {
          circleRef.current.setLatLng(at).setRadius(readRadius());
        } else {
          circleRef.current = L.circle(at, {
            radius: readRadius(),
            className: "oms-pick-ring",
          }).addTo(map);
        }
        if (recentre) map.setView(at, Math.max(map.getZoom(), 16));
      };

      const write = (lat: number, lng: number, recentre: boolean) => {
        // Seven decimals is a little over a centimetre, and matches the
        // NUMERIC(10,7) the columns are declared as.
        if (latRef.current) latRef.current.value = lat.toFixed(7);
        if (lngRef.current) lngRef.current.value = lng.toFixed(7);
        draw([lat, lng], recentre);
      };
      writeRef.current = write;

      draw(start, false);

      map.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        write(e.latlng.lat, e.latlng.lng, false);
        setStatus(null);
      });

      // Typing the numbers by hand still works; the pin follows along.
      const onType = () => draw(readPoint(), false);
      const latEl = latRef.current;
      const lngEl = lngRef.current;
      latEl?.addEventListener("input", onType);
      lngEl?.addEventListener("input", onType);
      cleanups.push(() => {
        latEl?.removeEventListener("input", onType);
        lngEl?.removeEventListener("input", onType);
      });

      const form = latRef.current?.form;
      const radiusEl = radiusName
        ? (form?.elements.namedItem(radiusName) as HTMLInputElement | null)
        : null;
      if (radiusEl) {
        const onRadius = () => circleRef.current?.setRadius(readRadius());
        radiusEl.addEventListener("input", onRadius);
        cleanups.push(() => radiusEl.removeEventListener("input", onRadius));
      }

      if (form) {
        // `resetOnSuccess` empties the inputs, so the pin has to go with
        // them -- after the reset has landed, not before it.
        const onReset = () => setTimeout(() => draw(readPoint(), false), 0);
        form.addEventListener("reset", onReset);
        cleanups.push(() => form.removeEventListener("reset", onReset));
      }

      // Leaflet measures its container once, at creation. Inside a card that
      // is still laying out, that measurement comes up short.
      const settle = setTimeout(() => map.invalidateSize(), 0);
      cleanups.push(() => clearTimeout(settle));
    });

    return () => {
      cancelled = true;
      for (const fn of cleanups) fn();
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
      writeRef.current = null;
    };
  }, [radiusName]);

  const locate = () => {
    if (!navigator.geolocation) {
      setStatus("This browser has no location service -- click the spot instead.");
      return;
    }
    setStatus("Reading this device's location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        writeRef.current?.(pos.coords.latitude, pos.coords.longitude, true);
        setStatus(
          `Set from this device, accurate to about ${Math.round(pos.coords.accuracy)} m.`
        );
      },
      (err) => {
        setStatus(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was refused -- click the spot on the map instead."
            : "Could not read this device's location -- click the spot on the map instead."
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  /**
   * Looks a place name up against OpenStreetMap's own geocoder. One request
   * per deliberate click, which is well inside Nominatim's usage policy, and
   * the tiles are already attributed to the same project. A failure here is
   * never blocking: the map is still there to click.
   */
  const search = async () => {
    const query = searchRef.current?.value?.trim() ?? "";
    if (!query) return;
    setSearching(true);
    setStatus(null);
    try {
      const res = await fetch(
        "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
          encodeURIComponent(query),
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) throw new Error(String(res.status));
      const hits = (await res.json()) as {
        lat: string;
        lon: string;
        display_name: string;
      }[];
      const hit = hits[0];
      if (!hit) {
        setStatus(`Nothing found for "${query}" -- try a nearby landmark, or click the map.`);
        return;
      }
      writeRef.current?.(Number(hit.lat), Number(hit.lon), true);
      setStatus(`${hit.display_name} -- drag the pin if it is not exactly right.`);
    } catch {
      setStatus("The place lookup is unavailable -- click the spot on the map instead.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-2">
      <span className="label mb-0 block">
        {label}
        {!required && <span className="font-normal text-fg-subtle"> (optional)</span>}
      </span>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[12rem] flex-1 items-center gap-1.5">
          <input
            ref={searchRef}
            type="search"
            className="input"
            placeholder="Find a place, e.g. Banani, Dhaka"
            aria-label="Search for a place"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Enter in a search box must not submit the whole form.
                e.preventDefault();
                void search();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm shrink-0"
            disabled={searching}
            onClick={() => void search()}
          >
            <Search size={14} />
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={locate}>
          <LocateFixed size={14} />
          Use my location
        </button>
      </div>

      <div
        ref={containerRef}
        style={{ height }}
        className="w-full overflow-hidden rounded-xl border border-border"
        role="application"
        aria-label={`${label} -- click the map to place the point`}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={latName}>
            Latitude
          </label>
          <input
            ref={latRef}
            id={latName}
            name={latName}
            type="number"
            /*
               "any", not a 7-decimal step. A step makes the browser reject
               anything off its grid, and the coordinates people actually
               paste come from a mapping site with twelve or fourteen
               decimals -- so a correct value was refused with "please enter
               a valid value", naming two numbers a hair either side of it.
               The column is NUMERIC(10,7) and rounds to its own scale.
            */
            step="any"
            min={-90}
            max={90}
            required={required}
            defaultValue={defaultLat ?? ""}
            className="input tnum"
            aria-invalid={!!errors?.[latName]}
          />
          <FieldError errors={errors} name={latName} />
        </div>
        <div>
          <label className="label" htmlFor={lngName}>
            Longitude
          </label>
          <input
            ref={lngRef}
            id={lngName}
            name={lngName}
            type="number"
            step="any"
            min={-180}
            max={180}
            required={required}
            defaultValue={defaultLng ?? ""}
            className="input tnum"
            aria-invalid={!!errors?.[lngName]}
          />
          <FieldError errors={errors} name={lngName} />
        </div>
      </div>

      <p className="help" aria-live="polite">
        {status ?? help ?? "Click the map to place the point, or drag the pin to adjust it."}
      </p>
    </div>
  );
}
