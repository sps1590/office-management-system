import "server-only";
import { getDb } from "./db";

/**
 * Platform-operator queries: the only place in the codebase that reads across
 * tenants. Reachable only through requirePlatformAdmin(), which is granted
 * solely by the PLATFORM_ADMIN_IDENTIFIERS environment variable.
 *
 * Every statement here carries a `tenancy-ok` note because crossing the tenant
 * boundary is the deliberate purpose of this module, not an oversight.
 */

export async function listTenants() {
  const db = await getDb();
  const rows = await db`
    SELECT t.id, t.company_name, t.slug, t.status, t.plan_key, t.currency,
           t.country, t.email, t.trial_ends_on, t.created_at,
           p.name AS plan_name,
           (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id)        AS users,
           (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id
             AND u.status = 'active')                                          AS active_users,
           (SELECT MAX(u.last_login_at) FROM users u WHERE u.tenant_id = t.id) AS last_login_at,
           (SELECT COUNT(*)::int FROM location_logs l WHERE l.tenant_id = t.id
             AND l.log_timestamp > now() - INTERVAL '24 hours')                AS points_today
      FROM tenants t
      LEFT JOIN subscription_plans p ON p.key = t.plan_key
     ORDER BY t.created_at DESC
     -- tenancy-ok: the platform console lists every tenant by design
  `;
  return rows as unknown as {
    id: string;
    company_name: string;
    slug: string;
    status: string;
    plan_key: string;
    currency: string;
    country: string | null;
    email: string | null;
    trial_ends_on: string | null;
    created_at: string;
    plan_name: string | null;
    users: number;
    active_users: number;
    last_login_at: string | null;
    points_today: number;
  }[];
}

export async function platformStats() {
  const db = await getDb();
  const rows = await db`
    SELECT (SELECT COUNT(*)::int FROM tenants)                                AS tenants,
           (SELECT COUNT(*)::int FROM tenants WHERE status = 'active')         AS active,
           (SELECT COUNT(*)::int FROM tenants WHERE status = 'trial')          AS trialing,
           (SELECT COUNT(*)::int FROM tenants WHERE status = 'suspended')      AS suspended,
           (SELECT COUNT(*)::int FROM users)                                   AS users,
           (SELECT COUNT(*)::int FROM sessions WHERE expires_at > now())       AS live_sessions,
           (SELECT COUNT(*)::int FROM device_registrations WHERE is_active)    AS devices,
           (SELECT COALESCE(SUM(amount), 0)::float FROM tenant_subscriptions
             WHERE status = 'active')                                          AS mrr
    -- tenancy-ok: platform-wide totals
  `;
  return rows[0] as {
    tenants: number;
    active: number;
    trialing: number;
    suspended: number;
    users: number;
    live_sessions: number;
    devices: number;
    mrr: number;
  };
}

export async function listPlans() {
  const db = await getDb();
  const rows = await db`
    SELECT key, name, price_monthly::float AS price_monthly, max_users, features,
           (SELECT COUNT(*)::int FROM tenants t WHERE t.plan_key = subscription_plans.key) AS tenants
      FROM subscription_plans
     WHERE is_active = TRUE
     ORDER BY sort_order
     -- tenancy-ok: plans are platform-level reference data
  `;
  return rows as unknown as {
    key: string;
    name: string;
    price_monthly: number;
    max_users: number | null;
    features: Record<string, unknown>;
    tenants: number;
  }[];
}
