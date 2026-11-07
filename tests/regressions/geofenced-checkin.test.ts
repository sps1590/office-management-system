import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { checkInAction } from "@/lib/actions/attendance";
import { updateSettingsAction } from "@/lib/actions/admin";
import {
  createGeofenceAction,
  deleteGeofenceAction,
  toggleGeofenceAction,
} from "@/lib/actions/tracking";
import { addUser, createTestTenant, form, signInAs, type TestTenant } from "../helpers/world";

/*
   Regression: a brand-new company could not check anybody in.

   `require_geofenced_checkin` defaulted to TRUE while a fresh tenant has no
   geofence at all, so every check-in hit "You are outside every registered
   office location" -- naming the office rather than the missing fence, which
   makes the cause close to unguessable from the symptom. The fix is three
   parts, and this file holds one test per part:

   1. The column defaults to FALSE, so a new company can check in on day one.
   2. Turning the requirement on is refused while there is no active office or
      warehouse fence to satisfy it.
   3. Removing the last such fence while the requirement is on is refused, by
      both the deactivate and the delete path -- otherwise the dead end is
      simply reachable from the other direction.
*/
describe("geofenced check-in", () => {
  let tenant: TestTenant;
  let employeeId: string;

  /** The settings form, filled with the defaults the screen itself posts. */
  function settingsForm(overrides: Record<string, string | number | boolean> = {}) {
    return form({
      standardWorkMinutes: 480,
      workStartTime: "09:00",
      graceMinutes: 15,
      overtimeAfterMinutes: 480,
      overtimeMultiplier: 1.5,
      attendanceRadiusMeters: 200,
      telemetryIntervalSeconds: 60,
      telemetryRetentionDays: 90,
      trackingWindowStart: "07:00",
      trackingWindowEnd: "21:00",
      deviationThresholdMeters: 1000,
      invoicePrefix: "INV",
      poPrefix: "PO",
      fiscalYearStartMonth: 7,
      ...overrides,
    });
  }

  async function activeOfficeFences(): Promise<number> {
    const db = await getDb();
    const rows = await db`
      SELECT COUNT(*)::int AS n FROM geofences
       WHERE tenant_id = ${tenant.tenantId} AND is_active
         AND kind IN ('office','warehouse')
    `;
    return (rows[0] as { n: number }).n;
  }

  beforeAll(async () => {
    tenant = await createTestTenant();
    employeeId = await addUser(tenant.tenantId, { roleKey: "employee" });
  });

  afterAll(async () => {
    await tenant.drop();
  });

  it("does not require a location on a freshly provisioned tenant", async () => {
    const settings = await getSettings(tenant.tenantId);
    expect(settings.require_geofenced_checkin).toBe(false);
  });

  it("lets a new company check somebody in with no geofence anywhere", async () => {
    expect(await activeOfficeFences()).toBe(0);

    await signInAs(employeeId, tenant.tenantId);
    const result = await checkInAction(null, form({}));

    expect(result?.error, result?.error).toBeUndefined();
    expect(result?.success).toMatch(/Checked in/);

    const db = await getDb();
    const rows = await db`
      SELECT status, inside_geofence FROM attendance_records
       WHERE tenant_id = ${tenant.tenantId} AND user_id = ${employeeId}
    `;
    expect(rows).toHaveLength(1);
    // Nothing claimed to be inside anything; the day is simply recorded.
    expect((rows[0] as { inside_geofence: boolean | null }).inside_geofence).toBeNull();
  });

  it("refuses to require a location while there is no fence to satisfy it", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const result = await updateSettingsAction(
      null,
      settingsForm({ requireGeofencedCheckin: true })
    );

    expect(result?.success).toBeUndefined();
    expect(result?.error).toMatch(/no active office/i);
    // The refusal is aimed at the control that caused it, which is what
    // AutoForm's checkbox branch has to render.
    expect(result?.fieldErrors?.requireGeofencedCheckin).toBeDefined();

    // And it did not quietly save anyway.
    expect((await getSettings(tenant.tenantId)).require_geofenced_checkin).toBe(false);
  });

  it("allows it once an office fence exists", async () => {
    await signInAs(tenant.adminId, tenant.tenantId);
    const created = await createGeofenceAction(
      null,
      form({
        name: "Head Office",
        kind: "office",
        centerLat: 23.8103,
        centerLng: 90.4125,
        radiusMeters: 200,
      })
    );
    expect(created?.error, created?.error).toBeUndefined();
    expect(await activeOfficeFences()).toBe(1);

    const saved = await updateSettingsAction(
      null,
      settingsForm({ requireGeofencedCheckin: true })
    );
    expect(saved?.error, saved?.error).toBeUndefined();
    expect((await getSettings(tenant.tenantId)).require_geofenced_checkin).toBe(true);
  });

  it("refuses to deactivate the last office fence while the requirement is on", async () => {
    const db = await getDb();
    const fences = await db`
      SELECT id FROM geofences
       WHERE tenant_id = ${tenant.tenantId} AND name = 'Head Office'
    `;
    const fenceId = (fences[0] as { id: string }).id;

    await signInAs(tenant.adminId, tenant.tenantId);
    const toggled = await toggleGeofenceAction(null, form({ geofenceId: fenceId }));

    expect(toggled?.success).toBeUndefined();
    expect(toggled?.error).toMatch(/only active office geofence/i);
    expect(await activeOfficeFences()).toBe(1);
  });

  it("refuses to delete the last office fence while the requirement is on", async () => {
    const db = await getDb();
    const fences = await db`
      SELECT id FROM geofences
       WHERE tenant_id = ${tenant.tenantId} AND name = 'Head Office'
    `;
    const fenceId = (fences[0] as { id: string }).id;

    await signInAs(tenant.adminId, tenant.tenantId);
    const deleted = await deleteGeofenceAction(null, form({ geofenceId: fenceId }));

    expect(deleted?.success).toBeUndefined();
    expect(deleted?.error).toMatch(/only active office geofence/i);
    expect(await activeOfficeFences()).toBe(1);
  });

  it("allows the delete once the requirement is turned back off", async () => {
    // The refusal has to be specific to the dead end, not a blanket rule that
    // leaves a mistyped fence undeletable -- which was its own dead end, since
    // the name is unique per company and a deactivated fence still holds it.
    await signInAs(tenant.adminId, tenant.tenantId);
    const off = await updateSettingsAction(null, settingsForm({ requireGeofencedCheckin: false }));
    expect(off?.error, off?.error).toBeUndefined();

    const db = await getDb();
    const fences = await db`
      SELECT id FROM geofences
       WHERE tenant_id = ${tenant.tenantId} AND name = 'Head Office'
    `;
    const fenceId = (fences[0] as { id: string }).id;

    const deleted = await deleteGeofenceAction(null, form({ geofenceId: fenceId }));
    expect(deleted?.error, deleted?.error).toBeUndefined();
    expect(deleted?.success).toMatch(/deleted/i);
    expect(await activeOfficeFences()).toBe(0);
  });

  it("still refuses a check-in from outside the fence when the requirement is on", async () => {
    // The requirement itself has to work — the fix must not have defanged it.
    await signInAs(tenant.adminId, tenant.tenantId);
    await createGeofenceAction(
      null,
      form({
        name: "Second Office",
        kind: "office",
        centerLat: 23.8103,
        centerLng: 90.4125,
        radiusMeters: 200,
      })
    );
    await updateSettingsAction(null, settingsForm({ requireGeofencedCheckin: true }));

    const other = await addUser(tenant.tenantId, { roleKey: "employee" });
    await signInAs(other, tenant.tenantId);

    // Dhaka to Chattogram: comfortably outside a 200 m ring.
    const outside = await checkInAction(
      null,
      form({ latitude: 22.3569, longitude: 91.7832 })
    );
    expect(outside?.error).toMatch(/outside every registered office/i);

    const inside = await checkInAction(
      null,
      form({ latitude: 23.8103, longitude: 90.4125 })
    );
    expect(inside?.error, inside?.error).toBeUndefined();
    expect(inside?.success).toMatch(/Checked in/);
  });
});
