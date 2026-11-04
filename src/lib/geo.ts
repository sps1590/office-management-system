// Geospatial maths for the GPS engine. No PostGIS: the system never needs a
// spatial join, only "how far is this point from that one" and "is this point
// inside that fence", both of which are a few lines here and avoid requiring
// an extension the Neon free tier may not enable.

const EARTH_RADIUS_M = 6_371_000;

export type Point = { latitude: number; longitude: number };

/** Great-circle distance in metres. */
export function distanceMeters(a: Point, b: Point): number {
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLng = (b.longitude - a.longitude) * toRad;
  const lat1 = a.latitude * toRad;
  const lat2 = b.latitude * toRad;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Ray-casting point-in-polygon. `polygon` is the [[lat, lng], …] array stored
 * in `geofences.polygon`. Treats the polygon as closed whether or not the
 * last vertex repeats the first.
 */
export function insidePolygon(point: Point, polygon: [number, number][]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    const straddles = latI > point.latitude !== latJ > point.latitude;
    if (!straddles) continue;
    const lngAtCrossing =
      lngI + ((point.latitude - latI) / (latJ - latI)) * (lngJ - lngI);
    if (point.longitude < lngAtCrossing) inside = !inside;
  }
  return inside;
}

export type Geofence = {
  id: string;
  name: string;
  shape: "circle" | "polygon";
  center_lat: number | null;
  center_lng: number | null;
  radius_meters: number | null;
  polygon: [number, number][] | null;
};

/** Inside the fence, plus how far from its boundary (or centre, for a circle). */
export function evaluateFence(
  point: Point,
  fence: Geofence
): { inside: boolean; distance: number | null } {
  if (fence.shape === "circle") {
    if (fence.center_lat == null || fence.center_lng == null) {
      return { inside: false, distance: null };
    }
    const d = distanceMeters(point, {
      latitude: Number(fence.center_lat),
      longitude: Number(fence.center_lng),
    });
    return { inside: d <= (fence.radius_meters ?? 0), distance: d };
  }

  const poly = (fence.polygon ?? []).map(
    ([lat, lng]) => [Number(lat), Number(lng)] as [number, number]
  );
  const inside = insidePolygon(point, poly);
  // Distance to the nearest vertex is a good-enough "how far outside" signal
  // for an alert message; an exact point-to-edge distance is not worth the
  // extra maths here.
  let nearest: number | null = null;
  for (const [lat, lng] of poly) {
    const d = distanceMeters(point, { latitude: lat, longitude: lng });
    if (nearest === null || d < nearest) nearest = d;
  }
  return { inside, distance: nearest };
}

/** Total path length in km — the distance travelled on a day's route. */
export function routeLengthKm(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distanceMeters(points[i - 1], points[i]);
  }
  return total / 1000;
}

/**
 * Drops points that barely moved, so a parked vehicle does not render as a
 * thousand overlapping markers and the map payload stays small.
 */
export function simplifyRoute<T extends Point>(points: T[], minMeters = 25): T[] {
  if (points.length < 3) return points;
  const out: T[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (distanceMeters(out[out.length - 1], points[i]) >= minMeters) {
      out.push(points[i]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Centre and zoom that fit every point — the map's initial view. */
export function boundsOf(points: Point[]): {
  center: [number, number];
  zoom: number;
} {
  if (points.length === 0) return { center: [23.8103, 90.4125], zoom: 11 }; // Dhaka
  let minLat = 90,
    maxLat = -90,
    minLng = 180,
    maxLng = -180;
  for (const p of points) {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
  }
  const spread = Math.max(maxLat - minLat, maxLng - minLng);
  const zoom =
    spread > 8 ? 5 : spread > 3 ? 7 : spread > 1 ? 9 : spread > 0.3 ? 11 : spread > 0.05 ? 13 : 15;
  return { center: [(minLat + maxLat) / 2, (minLng + maxLng) / 2], zoom };
}
