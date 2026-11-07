import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocationPicker from "@/components/LocationPicker";
import { getDb } from "@/lib/db";
import { createGeofenceAction } from "@/lib/actions/tracking";
import { createTestTenant, form, signInAs, type TestTenant } from "../helpers/world";

/*
   Regression: a coordinate pasted from a mapping site was refused.

   The latitude and longitude inputs carried `step="0.0000001"`, matching the
   column's NUMERIC(10,7). A browser rejects anything off a step's grid, and
   what people actually paste from Google Maps has twelve or fourteen
   decimals -- so a correct value was refused by the browser with "please
   enter a valid value", naming two numbers a hair either side of it, and the
   form never reached the server at all.

   `step="any"` is the fix: the input accepts the paste, and the column rounds
   to its own scale on the way in. Both halves are checked below -- the markup
   and the round trip -- because either one alone would let the bug back.
*/

/** Fourteen decimals, as copied out of Google Maps. */
const PASTED_LAT = "23.78063184409876";
const PASTED_LNG = "90.41659287654321";

describe("a pasted coordinate", () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await createTestTenant();
  });

  afterAll(async () => {
    await tenant.drop();
  });

  it("is not constrained by a step on either input", () => {
    const html = renderToStaticMarkup(
      <LocationPicker latName="centerLat" lngName="centerLng" label="Centre" />
    );

    const lat = /<input[^>]*name="centerLat"[^>]*>/.exec(html)?.[0] ?? "";
    const lng = /<input[^>]*name="centerLng"[^>]*>/.exec(html)?.[0] ?? "";

    expect(lat).toContain('type="number"');
    expect(lng).toContain('type="number"');
    // "any", not a 7-decimal grid. A `step` here is the bug.
    expect(lat).toContain('step="any"');
    expect(lng).toContain('step="any"');
    expect(lat).not.toMatch(/step="0/);
    expect(lng).not.toMatch(/step="0/);
  });

  it("is accepted by the action, and rounded to the column's scale", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const result = await createGeofenceAction(
      null,
      form({
        name: "Pasted Office",
        kind: "office",
        centerLat: PASTED_LAT,
        centerLng: PASTED_LNG,
        radiusMeters: 150,
      })
    );

    expect(result?.fieldErrors, JSON.stringify(result?.fieldErrors)).toBeUndefined();
    expect(result?.error, result?.error).toBeUndefined();

    const db = await getDb();
    const rows = await db`
      SELECT center_lat::text AS lat, center_lng::text AS lng FROM geofences
       WHERE tenant_id = ${tenant.tenantId} AND name = 'Pasted Office'
    `;
    const stored = rows[0] as { lat: string; lng: string };

    // NUMERIC(10,7): seven decimal places, which is about a centimetre --
    // the only precision in those fourteen digits that means anything.
    expect(stored.lat).toBe("23.7806318");
    expect(stored.lng).toBe("90.4165929");

    // And it is still the same place: under a centimetre from the paste.
    expect(Number(stored.lat)).toBeCloseTo(Number(PASTED_LAT), 7);
    expect(Number(stored.lng)).toBeCloseTo(Number(PASTED_LNG), 7);
  });

  it("still refuses a coordinate that is not on Earth", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const result = await createGeofenceAction(
      null,
      form({
        name: "Nowhere",
        kind: "office",
        centerLat: "91.5",
        centerLng: "90.4165928",
        radiusMeters: 150,
      })
    );
    expect(result?.fieldErrors?.centerLat).toBeDefined();
  });

  it("still refuses the 0,0 placeholder, which is nobody's office", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const result = await createGeofenceAction(
      null,
      form({ name: "Null Island", kind: "office", centerLat: 0, centerLng: 0, radiusMeters: 150 })
    );
    expect(result?.fieldErrors?.centerLat?.[0]).toMatch(/centre coordinates/i);
  });
});
