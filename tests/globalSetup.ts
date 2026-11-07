import { assertThrowawayDatabase, loadTestEnv } from "./helpers/env";

/*
   Runs once, before any test file.

   Order matters: the interlock goes first, so a TEST_DATABASE_URL pointing at
   a real database is refused before this file writes anything to it.

   Then the schema. `getDb()` fingerprints the statement list and applies it
   when the database does not match -- which a fresh schema-only branch never
   does, since it carries no rows and therefore no `schema_state` row. Doing
   it here rather than letting the first test trigger it means the 140-odd
   DDL statements run once, in one place, instead of being raced for by
   several workers.
*/
export default async function setup() {
  loadTestEnv();
  await assertThrowawayDatabase();

  const started = Date.now();
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  const tables = await db`
    SELECT COUNT(*)::int AS n FROM information_schema.tables
     WHERE table_schema = 'public'
    -- tenancy-ok: counting the test database's own tables
  `;
  const roles = await db`
    SELECT COUNT(*)::int AS n FROM roles WHERE tenant_id IS NULL
    -- tenancy-ok: the platform's role templates are deliberately tenant-less
  `;

  console.log(
    `[test db] schema ready in ${Date.now() - started} ms — ` +
      `${(tables[0] as { n: number }).n} tables, ` +
      `${(roles[0] as { n: number }).n} role templates.`
  );

  // Anything a crashed earlier run left behind. Only ever tenants the suite
  // named itself; see dropAllTestTenants.
  const { dropAllTestTenants } = await import("./helpers/world");
  const swept = await dropAllTestTenants();
  if (swept > 0) console.log(`[test db] swept ${swept} tenant(s) from an earlier run.`);

  return async () => {
    const left = await dropAllTestTenants();
    if (left > 0) console.log(`[test db] removed ${left} tenant(s) created by this run.`);
  };
}
