import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { SCHEMA_STATEMENTS } from "./schema";
import { SYSTEM_ROLES } from "./modules";

// One shared Postgres (Neon) client for the whole server process. The schema
// and the platform-level seed data are ensured once per process and cached on
// globalThis, so Next.js's dev-mode hot reload does not re-run them on every
// file save.

declare global {
  // eslint-disable-next-line no-var
  var __omsDbReady: Promise<void> | undefined;
}

let client: NeonQueryFunction<false, false> | undefined;

/**
 * Connects on first use rather than at import time. `next build` imports every
 * module to collect metadata and routes; throwing at import would make the
 * build itself require a database URL, which it should not.
 */
function connect(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env.local and fill in the Neon connection string."
      );
    }
    client = neon(url);
  }
  return client;
}

const DEFAULT_PLANS = [
  {
    key: "starter",
    name: "Starter",
    price_monthly: 0,
    max_users: 10,
    features: { modules: "core", gps_tracking: false, support: "community" },
    sort_order: 1,
  },
  {
    key: "business",
    name: "Business",
    price_monthly: 4900,
    max_users: 100,
    features: { modules: "all", gps_tracking: true, support: "email" },
    sort_order: 2,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price_monthly: 14900,
    max_users: null,
    features: { modules: "all", gps_tracking: true, mdm: true, support: "dedicated" },
    sort_order: 3,
  },
];

async function seedSubscriptionPlans() {
  const sql = connect();
  for (const p of DEFAULT_PLANS) {
    await sql`
      INSERT INTO subscription_plans (key, name, price_monthly, max_users, features, sort_order)
      VALUES (${p.key}, ${p.name}, ${p.price_monthly}, ${p.max_users},
              ${JSON.stringify(p.features)}::jsonb, ${p.sort_order})
      ON CONFLICT (key) DO UPDATE
        SET name = EXCLUDED.name,
            price_monthly = EXCLUDED.price_monthly,
            max_users = EXCLUDED.max_users,
            features = EXCLUDED.features,
            sort_order = EXCLUDED.sort_order
    `;
  }
}

// The role *templates* (tenant_id IS NULL) from SRS section 2. A tenant gets
// its own editable copy at signup; these rows are the source for that copy and
// are refreshed on every cold start, so a corrected default reaches new
// tenants without touching any tenant's customised matrix.
async function seedSystemRoleTemplates() {
  const sql = connect();
  for (const r of SYSTEM_ROLES) {
    const existing = await sql`
      SELECT id FROM roles WHERE tenant_id IS NULL AND key = ${r.key}
      -- tenancy-ok: system role templates are deliberately tenant-less
    `;
    if (existing.length === 0) {
      await sql`
        INSERT INTO roles (tenant_id, key, role_name, description, permissions_matrix, is_system, sort_order)
        VALUES (NULL, ${r.key}, ${r.name}, ${r.description},
                ${JSON.stringify(r.matrix)}::jsonb, TRUE, ${r.sort_order})
      `;
    } else {
      await sql`
        UPDATE roles
           SET role_name = ${r.name}, description = ${r.description},
               permissions_matrix = ${JSON.stringify(r.matrix)}::jsonb,
               sort_order = ${r.sort_order}
         WHERE tenant_id IS NULL AND key = ${r.key}
         -- tenancy-ok: system role templates are deliberately tenant-less
      `;
    }
  }
}

// Super Admin comes from an env var (comma-separated emails), re-applied on
// every cold start: removing someone from the list revokes them on the next
// one. With the variable unset, nobody is a platform admin.
async function syncPlatformAdmins() {
  const sql = connect();
  const ids = (process.env.PLATFORM_ADMIN_IDENTIFIERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  await sql`
    UPDATE users
       SET is_platform_admin = (LOWER(email) = ANY(${ids}))
     WHERE is_platform_admin IS DISTINCT FROM (LOWER(email) = ANY(${ids}))
     -- tenancy-ok: platform admin is assigned across every tenant by design
  `;
}

// Expired sessions and spent rate-limit windows accumulate forever otherwise.
// Cheap enough to run on a cold start; both are indexed.
async function pruneEphemeral() {
  const sql = connect();
  await sql`DELETE FROM sessions WHERE expires_at < now() - INTERVAL '7 days'
            -- tenancy-ok: housekeeping across all tenants`;
  await sql`DELETE FROM rate_limits WHERE window_start < now() - INTERVAL '1 day'
            -- tenancy-ok: housekeeping, the table has no tenant column`;
}

async function ensureSchema(): Promise<void> {
  const sql = connect();
  for (const statement of SCHEMA_STATEMENTS) {
    await sql.query(statement);
  }
  await seedSubscriptionPlans();
  await seedSystemRoleTemplates();
  await syncPlatformAdmins();
  await pruneEphemeral();
}

/**
 * Every data-access function goes through this rather than importing the
 * client directly, so the schema is guaranteed to exist before the first query
 * of a cold start.
 */
export async function getDb(): Promise<NeonQueryFunction<false, false>> {
  if (!globalThis.__omsDbReady) {
    globalThis.__omsDbReady = ensureSchema().catch((err) => {
      // Clear the cache so the next request retries, instead of the process
      // being stuck with a rejected promise for its whole lifetime.
      globalThis.__omsDbReady = undefined;
      throw err;
    });
  }
  await globalThis.__omsDbReady;
  return connect();
}
