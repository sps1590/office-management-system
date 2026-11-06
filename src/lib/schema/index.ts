// The single definition of this system's database schema.
//
// There is no separate migration runner. This ordered list of idempotent
// statements both creates a fresh database and brings an already-deployed one
// up to date, and it is executed on the first request of a server process
// whose fingerprint does not match the one recorded in schema_state (see
// ensureSchema in src/lib/db.ts). That means every statement must be safe to run against
// a database where it has already been applied:
//
//   CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
//   ALTER TABLE ... ADD COLUMN IF NOT EXISTS
//   ALTER TABLE ... DROP CONSTRAINT IF EXISTS, then ADD CONSTRAINT
//
// Order matters: a table must exist before anything references it. Where two
// tables reference each other, the second constraint is added after both
// exist (departments <-> users, vehicle_maintenance -> vendors,
// attendance_records -> geofences).

import { PLATFORM_SCHEMA } from "./platform";
import { IDENTITY_SCHEMA } from "./identity";
import { HR_SCHEMA } from "./hr";
import { FLEET_SCHEMA } from "./fleet";
import { PROCUREMENT_SCHEMA } from "./procurement";
import { CRM_SCHEMA } from "./crm";
import { FINANCE_SCHEMA } from "./finance";
import { WORKPLACE_SCHEMA } from "./workplace";
import { TELEMETRY_SCHEMA } from "./telemetry";
import { INDEX_STATEMENTS } from "./indexes";

export const SCHEMA_STATEMENTS: string[] = [
  ...PLATFORM_SCHEMA,
  ...IDENTITY_SCHEMA,
  ...HR_SCHEMA,
  ...FLEET_SCHEMA,
  ...PROCUREMENT_SCHEMA,
  ...CRM_SCHEMA,
  ...FINANCE_SCHEMA,
  ...WORKPLACE_SCHEMA,
  ...TELEMETRY_SCHEMA,
  ...INDEX_STATEMENTS,
];
