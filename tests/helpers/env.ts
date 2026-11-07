import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/*
   Points the product's `getDb()` at the throwaway Neon branch.

   NMCP is a live tenant with real people's attendance, salaries and
   locations in it. Two independent things keep this suite away from it:

   1. The suite reads TEST_DATABASE_URL, never DATABASE_URL, and never reads
      .env.local at all. A developer's working connection string cannot be
      picked up by accident, because nothing here looks for it.
   2. `assertThrowawayDatabase()` below refuses to run against any database
      that already holds a tenant this suite did not create. On the live
      branch that is NMCP, and the suite stops before its first query.

   Upstream of both, scripts/test-branch.mjs creates the branch
   `--schema-only`, so the test database has the schema and none of the rows.
*/

/** Every tenant the suite creates is named with this prefix. */
export const TEST_SLUG_PREFIX = "vitest-";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * Loads `.env.test` and sets up the process for the suite. Idempotent, so it
 * can run from globalSetup and again in every worker.
 */
export function loadTestEnv(): { databaseUrl: string } {
  const envTest = join(ROOT, ".env.test");
  if (!process.env.TEST_DATABASE_URL && existsSync(envTest)) {
    for (const [key, value] of Object.entries(parseEnvFile(readFileSync(envTest, "utf8")))) {
      process.env[key] ??= value;
    }
  }

  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is not set and .env.test does not exist.\n" +
        "Create the throwaway Neon branch first:\n\n" +
        "    npm run test:branch:create\n"
    );
  }

  process.env.DATABASE_URL = databaseUrl;
  // Nobody is a platform admin in the test database. db.ts re-applies this
  // list on every cold start, and a stray value here would hand a test tenant
  // cross-tenant read access and quietly invalidate the isolation tests.
  process.env.PLATFORM_ADMIN_IDENTIFIERS = "";
  process.env.TELEMETRY_TOKEN_SECRET ??= "vitest-telemetry-secret-not-a-real-one";
  // NODE_ENV is left alone: vitest already sets it to "test", and @types/node
  // declares it read-only.

  return { databaseUrl };
}

/**
 * The interlock. Refuses to go any further if the database holds a tenant
 * this suite did not create — which is what the production branch looks like.
 */
export async function assertThrowawayDatabase(): Promise<void> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(loadTestEnv().databaseUrl);

  let rows: Record<string, unknown>[];
  try {
    rows = await sql`
      SELECT slug, company_name FROM tenants
       WHERE slug NOT LIKE ${`${TEST_SLUG_PREFIX}%`}
       LIMIT 5
    `;
  } catch (err) {
    // A brand-new branch has no tables yet. That is the safest state there
    // is, so it is not a failure — globalSetup applies the schema next.
    if ((err as { code?: string }).code === "42P01") return;
    throw err;
  }

  if (rows.length > 0) {
    const names = rows.map((r) => `${r.company_name} (${r.slug})`).join(", ");
    throw new Error(
      "REFUSING TO RUN: this database already holds tenants the test suite did " +
        `not create — ${names}.\n\n` +
        "TEST_DATABASE_URL looks like it points at a real database. The suite " +
        "provisions and deletes tenants, so it must only ever reach a throwaway " +
        "Neon branch created by:\n\n    npm run test:branch:create\n"
    );
  }
}
