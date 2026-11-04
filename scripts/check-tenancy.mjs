#!/usr/bin/env node
/**
 * Multi-tenant isolation check. Run before any commit that touches SQL:
 *
 *   npm run check:tenancy
 *
 * It does two things:
 *
 *  1. Reads every CREATE TABLE in src/lib/schema/ and works out which tables
 *     are tenant-scoped (they have a tenant_id column). Nothing is hard-coded,
 *     so a table added tomorrow is covered today.
 *
 *  2. Scans every SQL template literal in src/ and fails when a statement
 *     touches a tenant-scoped table without filtering on tenant_id.
 *
 * A deliberate exception carries a `-- tenancy-ok: <reason>` comment inside
 * the statement — for example the login lookup, which happens before any
 * tenant is known, and the platform operator's cross-tenant queries.
 *
 * This is a lint, not a proof: it reads text, not semantics. It exists to
 * catch the one mistake that would leak one company's data to another.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");
const SCHEMA_DIR = join(SRC, "lib", "schema");

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Tables that carry a tenant_id column, read from the schema definition. */
async function tenantScopedTables() {
  const scoped = new Set();
  const all = new Set();
  for (const file of await walk(SCHEMA_DIR)) {
    const text = await readFile(file, "utf8");
    const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\s*\)`/g;
    let m;
    while ((m = re.exec(text))) {
      const [, table, body] = m;
      all.add(table);
      if (/\btenant_id\b/.test(body)) scoped.add(table);
    }
  }
  return { scoped, all };
}

/**
 * Pulls out every SQL template literal. Matches db`...` / sql`...` and the
 * `sql.query("...")` form used for DDL.
 */
function sqlStatements(text) {
  const found = [];
  const re = /\b(?:db|sql)`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(text))) {
    found.push({ sql: m[1], index: m.index });
  }
  return found;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

const VERBS = /\b(FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/gi;

async function main() {
  const { scoped, all } = await tenantScopedTables();
  if (scoped.size === 0) {
    console.error("check:tenancy — could not read the schema. Has it moved?");
    process.exit(2);
  }

  const files = (await walk(SRC)).filter((f) => !f.includes(`${join("lib", "schema")}`));
  const problems = [];
  let checked = 0;

  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const { sql, index } of sqlStatements(text)) {
      checked += 1;

      // An explicit, reasoned exception.
      if (/--\s*tenancy-ok:/i.test(sql)) continue;
      // DDL and housekeeping on tables that have no tenant column.
      if (/^\s*(CREATE|ALTER|DROP)\b/i.test(sql)) continue;

      const touched = new Set();
      VERBS.lastIndex = 0;
      let t;
      while ((t = VERBS.exec(sql))) {
        const table = t[2].toLowerCase();
        if (scoped.has(table)) touched.add(table);
      }
      if (touched.size === 0) continue;

      // Any mention of tenant_id in the statement counts: it may be
      // `WHERE tenant_id = ${...}`, a join condition, or an INSERT column list.
      if (/\btenant_id\b/.test(sql)) continue;

      problems.push({
        file: relative(ROOT, file),
        line: lineOf(text, index),
        tables: [...touched].join(", "),
        snippet: sql.trim().split("\n")[0].slice(0, 100),
      });
    }
  }

  console.log(
    `check:tenancy — ${checked} SQL statements across ${files.length} files; ` +
      `${scoped.size} of ${all.size} tables are tenant-scoped.`
  );

  if (problems.length > 0) {
    console.error(`\n${problems.length} statement(s) touch tenant data without a tenant_id filter:\n`);
    for (const p of problems) {
      console.error(`  ${p.file}:${p.line}`);
      console.error(`    tables: ${p.tables}`);
      console.error(`    ${p.snippet}…\n`);
    }
    console.error(
      "Filter by tenant_id from the session, or add `-- tenancy-ok: <reason>` if the\n" +
        "statement is deliberately cross-tenant (login, platform console, housekeeping).\n"
    );
    process.exit(1);
  }

  console.log("check:tenancy — every tenant-scoped query filters by tenant_id. ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
