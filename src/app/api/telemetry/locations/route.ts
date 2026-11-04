import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestPoints, resolveDevice } from "@/lib/telemetry";
import { allow, telemetryBucket } from "@/lib/rate-limit";

/**
 * POST /api/telemetry/locations
 * Authorization: Bearer <tracking_token>
 *
 * Batched coordinate ingest. Accepts backdated points so an offline device can
 * flush its queue, and is idempotent on (device, timestamp) so a retried batch
 * cannot duplicate a route.
 *
 * tenant_id and user_id come from the token, never from the body.
 */

const pointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  log_timestamp: z.string().optional(),
  accuracy_meters: z.number().optional(),
  activity_state: z.string().max(40).optional(),
  speed_kph: z.number().optional(),
  heading: z.number().optional(),
  battery_percent: z.number().optional(),
});

const schema = z.object({
  // A single point may be posted directly, which keeps a simple client simple.
  points: z.array(pointSchema).min(1).max(500).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  log_timestamp: z.string().optional(),
  accuracy_meters: z.number().optional(),
  activity_state: z.string().max(40).optional(),
  speed_kph: z.number().optional(),
  battery_percent: z.number().optional(),
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  const device = await resolveDevice(token);
  if (!device) {
    return NextResponse.json(
      { error: "Unknown or revoked device token." },
      { status: 401, headers: CORS }
    );
  }

  // Generous, but a device stuck in a loop cannot flood the table: at one
  // batch per second a well-behaved client never comes close.
  if (!(await allow(telemetryBucket(device.deviceId), 120, 60))) {
    return NextResponse.json(
      { error: "Ingest rate limit exceeded." },
      { status: 429, headers: CORS }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400, headers: CORS });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload.", details: z.flattenError(parsed.error).fieldErrors },
      { status: 400, headers: CORS }
    );
  }

  const d = parsed.data;
  const points =
    d.points ??
    (d.latitude != null && d.longitude != null
      ? [
          {
            latitude: d.latitude,
            longitude: d.longitude,
            log_timestamp: d.log_timestamp,
            accuracy_meters: d.accuracy_meters,
            activity_state: d.activity_state,
            speed_kph: d.speed_kph,
            battery_percent: d.battery_percent,
          },
        ]
      : []);

  if (points.length === 0) {
    return NextResponse.json(
      { error: "Send either a points array or a single latitude/longitude pair." },
      { status: 400, headers: CORS }
    );
  }

  const result = await ingestPoints(device, points);

  return NextResponse.json(
    {
      accepted: result.accepted,
      rejected: result.rejected,
      geofence_events: result.geofenceEvents,
      interval_seconds: device.intervalSeconds,
    },
    { headers: CORS }
  );
}
