# Mobile client & enterprise GPS deployment

SRS section 3.2 requires **silent background GPS tracking** for field-based
roles, deployed through corporate **MDM** so the app is not "repeatedly
prompting the user for permission".

This document records exactly what the web repository provides, what a native
client must do, and how the MDM side is configured. It exists so the native
app can be built later without re-deriving the contract.

---

## 1. Why this cannot be a web feature

| Requirement | Browser reality |
|---|---|
| Collect coordinates with the app closed | Browsers suspend JavaScript when a tab is backgrounded; `geolocation.watchPosition` stops. No web API grants background location. |
| Never prompt the user | The geolocation permission prompt is mandated by the browser and cannot be pre-granted by a server. |
| Untamperable by the user | A user can revoke a site permission at any time from the browser UI. |
| MDM-managed | MDM profiles target installed applications, not websites. |

Therefore the tracking **engine** lives on the server (built, in this repo)
and the **collector** must be a native binary (specified here, not built).

## 2. What this repository provides

### 2.1 Device enrolment

```
POST /api/telemetry/enroll
Content-Type: application/json

{ "email": "driver@acme.com", "password": "…", "device_id": "<stable device id>",
  "platform": "android" | "ios", "mdm_enrolled": true }

200 → { "tracking_token": "<opaque, long-lived>", "user_id": "…",
         "tenant_id": "…", "interval_seconds": 60 }
```

Called once at provisioning. Under MDM the credentials are injected as
managed app configuration, so no human types them. The returned token is
stored by the app in the platform keystore; only its SHA-256 hash is kept
server-side, in `device_registrations.token_hash`.

### 2.2 Batched coordinate ingest

```
POST /api/telemetry/locations
Authorization: Bearer <tracking_token>

{ "points": [
    { "latitude": 23.780636, "longitude": 90.419325,
      "log_timestamp": "2026-11-04T09:15:00Z", "accuracy_meters": 12.4,
      "activity_state": "In-Transit", "speed_kph": 34.2, "battery_percent": 78 }
  ] }

200 → { "accepted": 1, "rejected": 0, "geofence_events": 0 }
```

Design points that matter to a native client:

- **Batched and backdated.** Send up to 500 points per request with their
  original timestamps. A device that was offline flushes its queue and the
  history is reconstructed correctly, so a tunnel or a dead zone does not
  create a gap the map cannot explain.
- **Idempotent.** `(device_id, log_timestamp)` is unique; a retried batch
  does not duplicate rows.
- **Server-side authority.** The endpoint derives `tenant_id` and `user_id`
  from the token, never from the body. A compromised device cannot write
  another user's location.
- **Rate limited** per device.
- Geofences are evaluated on write, so deviation alerts fire without a cron.

### 2.3 Server-side engine (all built)

- Route reconstruction and playback on the live operations map.
- Circular and polygon geofences, with territory assignment per user.
- Enter / exit / deviation events written to `geofence_events` and raised as
  notifications to managers.
- Proof of presence: completing a task or field visit stamps coordinates and
  timestamp, and the distance to the client's recorded location is stored so
  a visit can be marked verified or disputed.

### 2.4 Interim collector that works today

`/tracker` is a PWA page for field users. It streams coordinates while open
with the screen on, using the same ingest endpoint and a session-derived
token. Useful immediately and for testing the whole pipeline — but it is
foreground-only and the user sees the browser's permission prompt.

---

## 3. Native client specification (not built)

Recommended: **Expo (React Native)** with `expo-location` and
`expo-task-manager`, which together give true background location on both
platforms.

Required behaviour:

1. On first launch, read managed configuration (MDM-injected credentials),
   call `/api/telemetry/enroll`, store the token in SecureStore / Keystore.
2. Start a background location task at the interval the server returned.
   Significant-change mode when stationary, time-based when moving — battery
   is the main field complaint.
3. Queue points in SQLite when offline; flush in batches of up to 500.
4. Screens: today's route, assigned trips (driver), assigned visits (sales),
   task list, check-in/out, expense capture.

Platform requirements:

- **iOS**: `UIBackgroundModes: location`,
  `NSLocationAlwaysAndWhenInUseUsageDescription`. Silent, non-revocable
  tracking requires a **supervised** device and a Jamf/Intune profile that
  pre-grants location and locks the privacy setting.
- **Android**: `ACCESS_BACKGROUND_LOCATION` and `FOREGROUND_SERVICE_LOCATION`.
  Under Android Enterprise, a **fully managed** device with a
  `PermissionGrantState: GRANT` policy pre-grants location with no prompt.

## 4. MDM configuration outline

| MDM | What to configure |
|---|---|
| Microsoft Intune | App configuration policy carrying `enroll_email` / `enroll_token`; app protection policy granting location; device restriction preventing the user from revoking it. |
| Jamf Pro | Supervised device, App Config profile with the same keys, Privacy Preferences Policy Control pre-approving location. |
| Android Enterprise | Fully managed device, Managed Configurations for credentials, `PermissionGrantState` set to `GRANT` for location. |

## 5. Legal note

Employee location tracking is regulated. Before switching this on, the
operator needs a written tracking policy, employee notice and (in many
jurisdictions) consent, a retention limit, and tracking restricted to working
hours. The system supports the last two: `tenant_settings` holds a retention
period in days and a tracking time window, and the data-governance screen can
purge telemetry older than the limit.
