"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

/**
 * The live operations map (SRS 3.1).
 *
 * Leaflet driven directly rather than through react-leaflet: the wrapper is
 * about sixty lines, carries no version coupling to React, and lets markers be
 * updated in place instead of the whole layer being torn down on every poll.
 *
 * Markers are `divIcon`s built from HTML, so there are no image assets to
 * break under bundling and the colours come from the same CSS tokens as the
 * rest of the product.
 */

export type MapPerson = {
  user_id: string;
  full_name: string;
  role_name: string | null;
  role_key: string | null;
  latitude: number;
  longitude: number;
  log_timestamp: string;
  activity_state: string | null;
  speed_kph: number | null;
  battery_percent: number | null;
  registration_number: string | null;
};

export type MapFence = {
  id: string;
  name: string;
  shape: "circle" | "polygon";
  center_lat: number | null;
  center_lng: number | null;
  radius_meters: number | null;
  polygon: [number, number][];
  color: string;
};

export type MapSite = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  kind: "warehouse" | "client";
};

const ROLE_COLOR: Record<string, string> = {
  driver: "#0891b2",
  sales_field: "#4f46e5",
  procurement_manager: "#d97706",
  fleet_manager: "#16a34a",
};

function personIcon(p: MapPerson) {
  const colour = ROLE_COLOR[p.role_key ?? ""] ?? "#6366f1";
  const initials = p.full_name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  const fresh = Date.now() - new Date(p.log_timestamp).getTime() < 15 * 60_000;
  return `
    <div style="position:relative">
      <div style="width:30px;height:30px;border-radius:50%;background:${colour};
                  color:#fff;font:600 11px/30px system-ui,sans-serif;text-align:center;
                  box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff">
        ${initials || "?"}
      </div>
      ${
        fresh
          ? `<span style="position:absolute;top:-2px;right:-2px;width:10px;height:10px;
                          border-radius:50%;background:#22c55e;border:2px solid #fff"></span>`
          : ""
      }
    </div>`;
}

function siteIcon(kind: "warehouse" | "client") {
  const colour = kind === "warehouse" ? "#b45309" : "#64748b";
  return `<div style="width:14px;height:14px;background:${colour};border:2px solid #fff;
                      border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`;
}

export default function OperationsMap({
  people = [],
  fences = [],
  sites = [],
  route = [],
  height = 520,
  /** Seconds between automatic refreshes. 0 disables polling. */
  refreshSeconds = 0,
}: {
  people?: MapPerson[];
  fences?: MapFence[];
  sites?: MapSite[];
  route?: { latitude: number; longitude: number; log_timestamp: string }[];
  height?: number;
  refreshSeconds?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keeps the Leaflet instances across renders without re-creating the map.
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Leaflet touches `window` at import time, so it is loaded dynamically
    // inside the effect rather than at module scope.
    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current) return;

      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, {
          zoomControl: true,
          attributionControl: true,
        }).setView([23.8103, 90.4125], 11);

        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap contributors",
        }).addTo(mapRef.current);

        layerRef.current = L.layerGroup().addTo(mapRef.current);
      }

      const map = mapRef.current;
      const layer = layerRef.current;
      if (!map || !layer) return;
      layer.clearLayers();

      for (const f of fences) {
        if (f.shape === "circle" && f.center_lat != null && f.center_lng != null) {
          L.circle([f.center_lat, f.center_lng], {
            radius: f.radius_meters ?? 200,
            color: f.color,
            weight: 2,
            fillOpacity: 0.08,
          })
            .bindPopup(`<strong>${f.name}</strong><br>Geofence`)
            .addTo(layer);
        } else if (f.polygon?.length >= 3) {
          L.polygon(f.polygon as [number, number][], {
            color: f.color,
            weight: 2,
            fillOpacity: 0.08,
          })
            .bindPopup(`<strong>${f.name}</strong><br>Territory`)
            .addTo(layer);
        }
      }

      for (const s of sites) {
        L.marker([s.latitude, s.longitude], {
          icon: L.divIcon({
            html: siteIcon(s.kind),
            className: "",
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          }),
        })
          .bindPopup(`<strong>${s.name}</strong><br>${s.kind}`)
          .addTo(layer);
      }

      if (route.length > 1) {
        L.polyline(
          route.map((p) => [p.latitude, p.longitude] as [number, number]),
          { color: "#4f46e5", weight: 3, opacity: 0.75 }
        ).addTo(layer);
        const start = route[0];
        const end = route[route.length - 1];
        L.circleMarker([start.latitude, start.longitude], {
          radius: 5,
          color: "#16a34a",
          fillOpacity: 1,
        })
          .bindPopup("Route start")
          .addTo(layer);
        L.circleMarker([end.latitude, end.longitude], {
          radius: 5,
          color: "#dc2626",
          fillOpacity: 1,
        })
          .bindPopup("Latest point")
          .addTo(layer);
      }

      for (const p of people) {
        const minutes = Math.round((Date.now() - new Date(p.log_timestamp).getTime()) / 60_000);
        L.marker([p.latitude, p.longitude], {
          icon: L.divIcon({
            html: personIcon(p),
            className: "",
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
        })
          .bindPopup(
            `<strong>${p.full_name}</strong><br>` +
              `${p.role_name ?? "—"}${p.registration_number ? ` · ${p.registration_number}` : ""}<br>` +
              `${p.activity_state ?? "Unknown"}` +
              `${p.speed_kph != null ? ` · ${Math.round(p.speed_kph)} km/h` : ""}<br>` +
              `<span style="opacity:.7">${
                minutes <= 1 ? "just now" : `${minutes} min ago`
              }${p.battery_percent != null ? ` · battery ${p.battery_percent}%` : ""}</span>`
          )
          .addTo(layer);
      }

      // Fit to whatever is on the map, but only on the first paint — refitting
      // on every poll would fight the user's own panning and zooming.
      const points: [number, number][] = [
        ...people.map((p) => [p.latitude, p.longitude] as [number, number]),
        ...route.map((p) => [p.latitude, p.longitude] as [number, number]),
        ...sites.map((s) => [s.latitude, s.longitude] as [number, number]),
      ];
      if (points.length > 0 && !map.getContainer().dataset.fitted) {
        map.fitBounds(L.latLngBounds(points).pad(0.25), { maxZoom: 15 });
        map.getContainer().dataset.fitted = "1";
      }
    });

    return () => {
      cancelled = true;
    };
  }, [people, fences, sites, route]);

  // Tear the map down only when the component itself unmounts.
  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (!refreshSeconds) return;
    const id = setInterval(() => window.location.reload(), refreshSeconds * 1000);
    return () => clearInterval(id);
  }, [refreshSeconds]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full rounded-xl overflow-hidden border border-border"
      role="application"
      aria-label="Live operations map"
    />
  );
}
