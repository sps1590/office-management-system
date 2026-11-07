import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { enrolDevice, ingestPoints, resolveDevice, type ResolvedDevice } from "@/lib/telemetry";
import { addUser, createTestTenant, type TestTenant } from "../helpers/world";

/*
   Regression: GPS telemetry ingest answered HTTP 500 to every request from
   the day it was written until 2026-11-07.

   `location_logs` is unique on (device_id, log_timestamp) through a *partial*
   index -- `WHERE device_id IS NOT NULL`. `ON CONFLICT (device_id,
   log_timestamp)` without that predicate gives Postgres no way to work out
   which index is meant, so it raised 42P10 on every call and the feature
   never stored a row. The docs called it complete.

   Reverting the `WHERE device_id IS NOT NULL` in `ingestPoints` makes the
   first assertion here throw 42P10.
*/
describe("telemetry ingest", () => {
  let tenant: TestTenant;
  let device: ResolvedDevice;

  /** How many rows this device has stored. */
  async function storedPoints(): Promise<number> {
    const db = await getDb();
    const rows = await db`
      SELECT COUNT(*)::int AS n FROM location_logs
       WHERE tenant_id = ${device.tenantId} AND device_id = ${device.deviceRowId}
    `;
    return (rows[0] as { n: number }).n;
  }

  /*
     Minutes before the moment this file loaded -- fixed, not relative to
     "now" at each call. A replay has to carry the *same* instants to be a
     replay at all: timestamps recomputed per call are new points, and an
     idempotency test built on them would pass no matter what ON CONFLICT
     did. `sanitise` drops anything in the future or over 30 days old.
  */
  const loadedAt = Date.now();
  function minutesAgo(n: number): string {
    return new Date(loadedAt - n * 60_000).toISOString();
  }

  /** The batch the first test stores and the third test replays verbatim. */
  const BATCH = [
    { latitude: 23.8103, longitude: 90.4125, log_timestamp: minutesAgo(30) },
    { latitude: 23.8113, longitude: 90.4135, log_timestamp: minutesAgo(20), speed_kph: 12.5 },
    {
      latitude: 23.8123,
      longitude: 90.4145,
      log_timestamp: minutesAgo(10),
      accuracy_meters: 8,
      activity_state: "In-Transit",
      battery_percent: 71,
    },
  ];

  beforeAll(async () => {
    tenant = await createTestTenant();
    const userId = await addUser(tenant.tenantId, { roleKey: "employee" });
    const { token } = await enrolDevice({
      tenantId: tenant.tenantId,
      userId,
      deviceId: "vitest-device-1",
      platform: "android",
      model: "Pixel (vitest)",
    });
    const resolved = await resolveDevice(token);
    expect(resolved, "the minted token should resolve to its own device").not.toBeNull();
    device = resolved!;
  });

  afterAll(async () => {
    await tenant.drop();
  });

  it("stores a batch of points", async () => {
    const result = await ingestPoints(device, BATCH);

    expect(result.accepted).toBe(3);
    expect(result.rejected).toBe(0);
    expect(await storedPoints()).toBe(3);
  });

  it("writes the optional columns it was given, and leaves the rest null", async () => {
    const db = await getDb();
    const rows = await db`
      SELECT latitude::float AS latitude, longitude::float AS longitude,
             accuracy_meters::float AS accuracy_meters, activity_state,
             speed_kph::float AS speed_kph, heading, battery_percent
        FROM location_logs
       WHERE tenant_id = ${device.tenantId} AND device_id = ${device.deviceRowId}
       ORDER BY log_timestamp
    `;
    const points = rows as unknown as {
      latitude: number;
      longitude: number;
      accuracy_meters: number | null;
      activity_state: string | null;
      speed_kph: number | null;
      heading: number | null;
      battery_percent: number | null;
    }[];

    expect(points).toHaveLength(3);
    expect(points[0].latitude).toBeCloseTo(23.8103, 6);
    expect(points[0].speed_kph).toBeNull();
    expect(points[1].speed_kph).toBeCloseTo(12.5, 2);
    expect(points[2].activity_state).toBe("In-Transit");
    expect(points[2].battery_percent).toBe(71);
    // Nothing set a heading on any of them.
    expect(points.every((p) => p.heading === null)).toBe(true);
  });

  it("is idempotent: replaying the same batch changes nothing", async () => {
    const before = await storedPoints();

    // An offline device that flushes, loses the response and flushes again.
    const replay = await ingestPoints(device, BATCH);
    expect(replay.accepted).toBe(0);
    expect(await storedPoints()).toBe(before);

    // And a third time, to be sure the count is not creeping.
    await ingestPoints(device, BATCH);
    expect(await storedPoints()).toBe(before);
  });

  it("de-duplicates two points sharing an instant inside one batch", async () => {
    const instant = minutesAgo(5);
    const result = await ingestPoints(device, [
      { latitude: 23.8203, longitude: 90.4225, log_timestamp: instant },
      { latitude: 23.8204, longitude: 90.4226, log_timestamp: instant },
    ]);
    // Two rows at the same instant collide with each other, not just with
    // what is stored, so the duplicate is dropped before the insert sees it.
    expect(result.accepted).toBe(1);
  });

  it("rejects a coordinate that is not on Earth, and keeps the rest", async () => {
    const before = await storedPoints();
    const result = await ingestPoints(device, [
      { latitude: 999, longitude: 90.4125, log_timestamp: minutesAgo(4) },
      { latitude: 23.8303, longitude: 90.4325, log_timestamp: minutesAgo(3) },
    ]);

    expect(result.rejected).toBe(1);
    expect(result.accepted).toBe(1);
    expect(await storedPoints()).toBe(before + 1);
  });

  it("attributes every point from the token, never from the payload", async () => {
    const db = await getDb();
    const rows = await db`
      SELECT DISTINCT user_id, tenant_id FROM location_logs
       WHERE tenant_id = ${device.tenantId} AND device_id = ${device.deviceRowId}
    `;
    expect(rows).toHaveLength(1);
    expect((rows[0] as { user_id: string }).user_id).toBe(device.userId);
  });

  it("does not resolve a revoked device's token", async () => {
    const userId = await addUser(tenant.tenantId, { roleKey: "employee" });
    const { token } = await enrolDevice({
      tenantId: tenant.tenantId,
      userId,
      deviceId: "vitest-device-2",
      platform: "ios",
    });
    expect(await resolveDevice(token)).not.toBeNull();

    const db = await getDb();
    await db`
      UPDATE device_registrations SET is_active = FALSE
       WHERE tenant_id = ${tenant.tenantId} AND device_id = 'vitest-device-2'
    `;
    expect(await resolveDevice(token)).toBeNull();
    expect(await resolveDevice("not-a-token-at-all")).toBeNull();
  });
});
