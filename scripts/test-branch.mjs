#!/usr/bin/env node
/*
   Creates and tears down the throwaway Neon branch the test suite runs
   against. Never the default branch: that one holds the live tenant.

   The branch is created `--schema-only`, which is the whole safety story.
   A normal Neon branch is a copy-on-write clone and would carry every row
   of production into the test database; a schema-only branch carries the
   63 tables and no rows at all, so there is nothing of a real company's
   for a test to read, change or delete. The suite then provisions its own
   tenants through the real signup path.

   Drives the Neon CLI rather than the hosted MCP server, which is not
   authorised in every environment this runs in.

     node scripts/test-branch.mjs create   # create (or reuse) and write .env.test
     node scripts/test-branch.mjs delete   # delete the branch and remove .env.test
     node scripts/test-branch.mjs ensure   # create only if .env.test is missing
*/
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const ENV_TEST = join(ROOT, ".env.test");
const BRANCH = process.env.TEST_NEON_BRANCH ?? "test";

/** Reads one key out of a dotenv-style file without pulling in a dependency. */
function fromEnvFile(file, key) {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const projectId =
  process.env.NEON_PROJECT_ID ??
  fromEnvFile(join(ROOT, ".env.local"), "NEON_PROJECT_ID");

if (!projectId) {
  console.error(
    "No Neon project id. Set NEON_PROJECT_ID, or put it in .env.local.\n" +
      "List your projects with: npx neon@latest projects list"
  );
  process.exit(1);
}

// Both of these end up on a command line (see neonRaw), so neither may be
// anything but an identifier.
if (!/^[a-z0-9-]+$/.test(projectId)) {
  console.error(`NEON_PROJECT_ID is not a Neon project id: ${projectId}`);
  process.exit(1);
}
if (!/^[A-Za-z0-9._-]+$/.test(BRANCH)) {
  console.error(`TEST_NEON_BRANCH is not a usable branch name: ${BRANCH}`);
  process.exit(1);
}

/*
   Everything reaching the shell here is either a literal in this file or one
   of the two identifiers checked above, so `shell: true` carries no injected
   input. It is needed because Node refuses to spawn a Windows `.cmd` (which
   is what `npx` is there) without one.
*/
function neonRaw(args) {
  const command = [
    "npx --yes neon@latest",
    ...args,
    "--project-id",
    projectId,
    "--output json",
  ].join(" ");
  return execSync(command, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Most subcommands answer JSON; `connection-string` answers a bare URI. */
function neon(args) {
  const out = neonRaw(args);
  return out.startsWith("{") || out.startsWith("[") ? JSON.parse(out) : out;
}

function branches() {
  const out = neon(["branches", "list"]);
  return Array.isArray(out) ? out : (out.branches ?? []);
}

function create() {
  const existing = branches().find((b) => b.name === BRANCH);
  if (existing) {
    console.log(`Branch "${BRANCH}" already exists (${existing.id}); reusing it.`);
    writeEnv(connectionString(), existing.id);
    return;
  }
  const created = neon([
    "branches",
    "create",
    "--name",
    BRANCH,
    "--parent",
    "main",
    // Schema, no rows. See the note at the top of this file.
    "--schema-only",
  ]);
  const id = created.branch?.id ?? created.id;
  const uri = created.connection_uris?.[0]?.connection_uri ?? connectionString();
  console.log(`Created schema-only branch "${BRANCH}" (${id}).`);
  writeEnv(uri, id);
}

function connectionString() {
  // The direct (non-pooled) string: the suite applies the schema, and Neon's
  // own guidance is that migrations do not go through the pooler.
  const out = neonRaw(["connection-string", BRANCH, "--database-name", "neondb"]);
  return out.split("\n").find((l) => l.trim().startsWith("postgres"))?.trim() ?? out;
}

function writeEnv(uri, branchId) {
  writeFileSync(
    ENV_TEST,
    [
      "# Written by scripts/test-branch.mjs — not committed, and not read by the app.",
      "# This is a throwaway Neon branch. `npm run test:branch:delete` destroys it.",
      `TEST_NEON_PROJECT_ID=${projectId}`,
      `TEST_NEON_BRANCH=${BRANCH}`,
      `TEST_NEON_BRANCH_ID=${branchId}`,
      `TEST_DATABASE_URL=${uri}`,
      "",
    ].join("\n"),
    "utf8"
  );
  console.log(`Wrote .env.test (TEST_DATABASE_URL for branch ${branchId}).`);
}

function destroy() {
  const found = branches().find((b) => b.name === BRANCH);
  if (!found) {
    console.log(`No branch named "${BRANCH}"; nothing to delete.`);
  } else if (found.default) {
    // The default branch is the one with the live tenant on it.
    console.error(`Refusing to delete "${BRANCH}": it is the project's default branch.`);
    process.exit(1);
  } else {
    neon(["branches", "delete", found.id]);
    console.log(`Deleted branch "${BRANCH}" (${found.id}).`);
  }
  rmSync(ENV_TEST, { force: true });
}

const command = process.argv[2] ?? "create";
if (command === "create") create();
else if (command === "ensure") {
  if (existsSync(ENV_TEST)) console.log(".env.test is present; leaving the branch alone.");
  else create();
} else if (command === "delete") destroy();
else {
  console.error(`Unknown command "${command}". Use create, ensure or delete.`);
  process.exit(1);
}
